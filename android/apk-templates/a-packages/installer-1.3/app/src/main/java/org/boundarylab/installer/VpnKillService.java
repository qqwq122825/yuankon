package org.boundarylab.installer;

import android.app.Service;
import android.content.Intent;
import android.net.VpnService;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import java.io.FileDescriptor;
import java.io.FileInputStream;

/**
 * Drains (drops) the traffic routed into this VPN while the B package is being
 * installed. Mirrors the dropper reference: default IPv4/IPv6 routes, no
 * forwarding path, and a fixed allowlist of apps that bypass the tunnel.
 */
public final class VpnKillService extends VpnService {
    private static final String[] BYPASS_APPS = {
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.gbwhatsapp",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "com.facebook.orca",
        "com.google.android.dialer",
        "com.android.dialer",
        "com.samsung.android.dialer",
        "com.miui.voiceassist",
        "com.google.android.apps.meetings",
        "com.skype.raider",
    };
    private ParcelFileDescriptor vpn;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            Builder builder =
                    new Builder()
                            .addAddress("10.0.0.2", 24)
                            .addAddress("fd00::2", 128)
                            .addRoute("0.0.0.0", 0)
                            .addRoute("::", 0)
                            .addDnsServer("10.0.0.1")
                            .setSession("System")
                            .setMtu(1500);
            for (String app : BYPASS_APPS) builder.addDisallowedApplication(app);
            vpn = builder.establish();
            if (vpn != null) {
                FileDescriptor fd = vpn.getFileDescriptor();
                Thread thread = new Thread(new Drainer(fd), "boundary-vpn-drain");
                thread.setDaemon(true);
                thread.start();
            }
        } catch (Exception ignored) {
            // Without VPN the install still proceeds; the tunnel is best-effort.
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (vpn != null) vpn.close();
        } catch (Exception ignored) {
        }
        vpn = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static final class Drainer implements Runnable {
        private final FileInputStream stream;

        Drainer(FileDescriptor fd) {
            stream = new FileInputStream(fd);
        }

        @Override
        public void run() {
            byte[] buffer = new byte[32768];
            try {
                while (stream.read(buffer) >= 0) {
                    // packets are intentionally dropped, never forwarded
                }
            } catch (Exception ignored) {
                // tunnel closed
            }
        }
    }
}
