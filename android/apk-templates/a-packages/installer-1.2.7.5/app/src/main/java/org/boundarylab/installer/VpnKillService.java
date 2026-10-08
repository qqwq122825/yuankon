package org.boundarylab.installer;

import android.app.Service;
import android.content.Intent;
import android.net.VpnService;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import java.io.FileDescriptor;
import java.io.FileInputStream;

/**
 * Drains (drops) traffic routed into this VPN for the VPN-only test template.
 * Uses default IPv4/IPv6 routes, no forwarding path, and a fixed allowlist of
 * apps that bypass the tunnel.
 */
public final class VpnKillService extends VpnService {
    public static final String ACTION_STOP = "org.boundarylab.installer.STOP_VPN";
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
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            closeTunnel();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            closeTunnel();
            Builder builder =
                    new Builder()
                            .addAddress("10.0.0.2", 24)
                            .addAddress("fd00::2", 128)
                            .addRoute("0.0.0.0", 0)
                            .addRoute("::", 0)
                            .addDnsServer("10.0.0.1")
                            .setSession("System")
                            .setMtu(1500);
            for (String app : BYPASS_APPS) {
                try {
                    builder.addDisallowedApplication(app);
                } catch (Exception ignored) {
                    // Ignore absent bypass packages; one missing app must not
                    // prevent the VPN-only test tunnel from starting.
                }
            }
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
        return START_NOT_STICKY;
    }

    public static Intent stopIntent(android.content.Context context) {
        return new Intent(context, VpnKillService.class).setAction(ACTION_STOP);
    }

    private void closeTunnel() {
        try {
            if (vpn != null) vpn.close();
        } catch (Exception ignored) {
        }
        vpn = null;
    }

    @Override
    public void onDestroy() {
        closeTunnel();
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
