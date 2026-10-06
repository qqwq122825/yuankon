package org.boundarylab.installer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * Static target for the PackageInstaller commit callback. On success it
 * brings the singleTop MainActivity to the front, whose onResume then stops
 * the VPN and continues into the accessibility guide. Cancellations are
 * handled by MainActivity's own onResume fallback.
 */
public final class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        if (status != PackageInstaller.STATUS_SUCCESS) return;
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT);
        try {
            context.startActivity(open);
        } catch (Exception ignored) {
        }
    }
}
