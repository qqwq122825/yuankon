import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Arrays;
import local.apkshield.runtime.PayloadCodec;

/** Host-side encryption plus verification using exactly the Android decoder. */
public final class PayloadTool {
    public static void main(String[] args) throws Exception {
        if (args.length != 4 || !(args[0].equals("encrypt") || args[0].equals("verify"))) {
            throw new IllegalArgumentException("encrypt|verify KEY_FILE PLAIN_ZIP PACKED_FILE");
        }
        byte[] key = Files.readAllBytes(Path.of(args[1]));
        byte[] plain = Files.readAllBytes(Path.of(args[2]));
        Path packedPath = Path.of(args[3]);
        if (args[0].equals("encrypt")) {
            byte[] nonce = new byte[12];
            new SecureRandom().nextBytes(nonce);
            byte[] encrypted = PayloadCodec.encrypt(plain, key, nonce);
            Files.write(packedPath, encrypted, java.nio.file.StandardOpenOption.CREATE_NEW);
        }
        byte[] packed = Files.readAllBytes(packedPath);
        if (!Arrays.equals(plain, PayloadCodec.decrypt(packed, key))) {
            throw new IllegalStateException("Roundtrip mismatch");
        }
        ByteBuffer[] dex = PayloadCodec.decode(packed, key);
        Arrays.fill(key, (byte) 0);
        System.out.println("AES-GCM roundtrip and shared Android decoder verified; DEX count=" + dex.length);
    }
}
