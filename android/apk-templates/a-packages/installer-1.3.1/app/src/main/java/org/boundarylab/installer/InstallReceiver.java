package org.boundarylab.installer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.Activity;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/**
 * Static target for the PackageInstaller commit callback.
 *
 * After commit(), Android returns PackageInstaller.EXTRA_INTENT when user
 * confirmation is required. The installer must launch that exact system
 * intent; otherwise the activity can remain stuck on “already handed to
 * Android installer” with no confirmation UI. Android 12+ also requires the
 * commit PendingIntent to be mutable so PackageInstaller can attach these
 * extras.
 *
 * STATUS_PENDING_USER_ACTION (-1) is handled explicitly, and the legacy
 * activity result code path is kept as an OEM compatibility fallback.
 *
 * STATUS_SUCCESS / STATUS_FAILURE / STATUS_FAILURE_* bring the single-top
 * MainActivity to the front; its onResume stops the VPN and either continues
 * into the accessibility guide (success) or resets for a retry (failure).
 */
public final class InstallReceiver extends BroadcastReceiver {
    private static final String TAG = "boundary-installer";
    private static final String STATE_PREFERENCES = "installer_state";
    private static final String ACCESSIBILITY_AFTER_INSTALL = "accessibility_after_install";
    private static final int STATUS_USER_ACTION_REQUESTED = 0x0100;

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -99);
        if (status == STATUS_USER_ACTION_REQUESTED
                || status == PackageInstaller.STATUS_PENDING_USER_ACTION
                || getResultCode() == Activity.RESULT_OK) {
            launchConfirmationUi(context, intent);
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            stopVpn(context);
            setAccessibilityPending(context, true);
            bringToFront(context);
            return;
        }
        if (status == PackageInstaller.STATUS_FAILURE
                || status == PackageInstaller.STATUS_FAILURE_ABORTED
                || status == PackageInstaller.STATUS_FAILURE_BLOCKED
                || status == PackageInstaller.STATUS_FAILURE_CONFLICT
                || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                || status == PackageInstaller.STATUS_FAILURE_INVALID
                || status == PackageInstaller.STATUS_FAILURE_STORAGE
                || status == PackageInstaller.STATUS_FAILURE_TIMEOUT) {
            stopVpn(context);
            setAccessibilityPending(context, false);
            bringToFront(context);
        }
    }

    private void launchConfirmationUi(Context context, Intent callback) {
        Intent confirmation;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            confirmation = callback.getParcelableExtra(
                    Intent.EXTRA_INTENT, Intent.class);
        } else {
            @SuppressWarnings("deprecation")
            Intent legacy = callback.getParcelableExtra(Intent.EXTRA_INTENT);
            confirmation = legacy;
        }
        if (confirmation == null) {
            Log.w(TAG, "user action requested without confirmation intent");
            bringToFront(context);
            return;
        }
        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(confirmation);
        } catch (Exception error) {
            Log.w(TAG, "launch install ui failed: " + error.getMessage());
            bringToFront(context);
        }
    }

    private static void stopVpn(Context context) {
        try {
            context.stopService(new Intent(context, VpnKillService.class));
        } catch (Exception ignored) {
        }
    }

    private static void setAccessibilityPending(Context context, boolean pending) {
        try {
            context.getSharedPreferences(STATE_PREFERENCES, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, pending)
                    .apply();
        } catch (Exception ignored) {
        }
    }

    private static void bringToFront(Context context) {
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (Exception ignored) {
        }
    }
}
