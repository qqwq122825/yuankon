package local.apkshield.runtime;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.Adler32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Shared JVM/Android format code. Uses standard AES-GCM, not a custom cipher. */
public final class PayloadCodec {
    public static final int MAX_BYTES = 64 * 1024 * 1024;
    public static final int MAX_DEX_BYTES = 32 * 1024 * 1024;
    public static final int MAX_DEX_COUNT = 16;
    private static final byte[] MAGIC = {'B', 'L', 'P', '1'};

    /** Optional metadata-only diagnostics; no dependency on Android logging on the host JVM. */
    public interface StageListener {
        void started(String stage);
        void completed(String stage, long elapsedNanos, int count, int bytes);
        void failed(String stage, long elapsedNanos, Throwable error);
    }

    private PayloadCodec() {}

    public static byte[] readBounded(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = in.read(buffer)) != -1) {
            if (count > limit - out.size()) throw new IOException("Payload size limit exceeded");
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }

    public static byte[] encrypt(byte[] plain, byte[] key, byte[] nonce)
            throws GeneralSecurityException, IOException {
        if (plain.length > MAX_BYTES || key.length != 32 || nonce.length != 12) {
            throw new IOException("Invalid payload, key or nonce size");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(MAGIC);
        byte[] ciphertext = cipher.doFinal(plain);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(MAGIC);
        out.write(nonce);
        out.write(ciphertext);
        return out.toByteArray();
    }

    public static byte[] decrypt(byte[] packed, byte[] key)
            throws GeneralSecurityException, IOException {
        if (packed.length < 32 || packed.length > MAX_BYTES + 32 || key.length != 32
                || !Arrays.equals(MAGIC, Arrays.copyOfRange(packed, 0, 4))) {
            throw new IOException("Invalid BLP1 container");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
            new GCMParameterSpec(128, Arrays.copyOfRange(packed, 4, 16)));
        cipher.updateAAD(MAGIC);
        return cipher.doFinal(packed, 16, packed.length - 16);
    }

    public static void validateDex(byte[] data) throws IOException, GeneralSecurityException {
        if (data.length < 112 || data.length > MAX_DEX_BYTES || data[0] != 'd'
                || data[1] != 'e' || data[2] != 'x' || data[3] != '\n' || data[7] != 0) {
            throw new IOException("Invalid DEX header");
        }
        String version = new String(data, 4, 3, java.nio.charset.StandardCharsets.US_ASCII);
        if (!Arrays.asList("035", "037", "038", "039").contains(version)) {
            throw new IOException("DEX version outside prototype support: " + version);
        }
        ByteBuffer header = ByteBuffer.wrap(data).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        if (header.getInt(32) != data.length || header.getInt(36) != 112
                || header.getInt(40) != 0x12345678) throw new IOException("Invalid DEX layout");
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        digest.update(data, 32, data.length - 32);
        if (!Arrays.equals(Arrays.copyOfRange(data, 12, 32), digest.digest())) {
            throw new IOException("DEX digest mismatch");
        }
        Adler32 checksum = new Adler32();
        checksum.update(data, 12, data.length - 12);
        if ((int) checksum.getValue() != header.getInt(8)) throw new IOException("DEX checksum mismatch");
    }

    public static ByteBuffer[] decode(byte[] packed, byte[] key)
            throws GeneralSecurityException, IOException {
        return decode(packed, key, null);
    }

    public static ByteBuffer[] decode(byte[] packed, byte[] key, StageListener listener)
            throws GeneralSecurityException, IOException {
        long started = start(listener, "payload.authenticate");
        byte[] plain;
        try {
            plain = decrypt(packed, key);
            complete(listener, "payload.authenticate", started, 0, plain.length);
        } catch (GeneralSecurityException | IOException error) {
            fail(listener, "payload.authenticate", started, error);
            throw error;
        }
        List<ByteBuffer> dex = new ArrayList<>();
        int total = 0;
        boolean decoded = false;
        started = start(listener, "payload.unpack");
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(plain))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                int index = dex.size() + 1;
                String expected = index == 1 ? "classes.dex" : "classes" + index + ".dex";
                if (index > MAX_DEX_COUNT || entry.isDirectory() || !expected.equals(entry.getName())) {
                    throw new IOException("Unexpected DEX entry: " + entry.getName());
                }
                String stage = "payload.dex." + index;
                long dexStarted = start(listener, stage);
                byte[] bytes = null;
                try {
                    bytes = readBounded(zip, Math.min(MAX_DEX_BYTES, MAX_BYTES - total));
                    validateDex(bytes);
                    total += bytes.length;
                    dex.add(ByteBuffer.wrap(bytes));
                    complete(listener, stage, dexStarted, index, bytes.length);
                } catch (GeneralSecurityException | IOException error) {
                    if (bytes != null) Arrays.fill(bytes, (byte) 0);
                    fail(listener, stage, dexStarted, error);
                    throw error;
                }
            }
            if (dex.isEmpty()) throw new IOException("Empty DEX payload");
            decoded = true;
        } catch (GeneralSecurityException | IOException error) {
            decoded = false;
            fail(listener, "payload.unpack", started, error);
            throw error;
        } finally {
            Arrays.fill(plain, (byte) 0);
            // Buffers returned successfully belong to the in-memory loader. Never wipe those.
            // On a thrown error this method does not transfer their ownership to the caller.
            if (!decoded) {
                for (ByteBuffer buffer : dex) Arrays.fill(buffer.array(), (byte) 0);
            }
        }
        complete(listener, "payload.unpack", started, dex.size(), total);
        return dex.toArray(new ByteBuffer[0]);
    }

    private static long start(StageListener listener, String stage) {
        if (listener != null) listener.started(stage);
        return System.nanoTime();
    }

    private static void complete(StageListener listener, String stage, long started, int count, int bytes) {
        if (listener != null) listener.completed(stage, System.nanoTime() - started, count, bytes);
    }

    private static void fail(StageListener listener, String stage, long started, Throwable error) {
        if (listener != null) listener.failed(stage, System.nanoTime() - started, error);
    }
}
