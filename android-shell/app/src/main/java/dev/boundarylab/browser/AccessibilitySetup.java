package dev.boundarylab.browser;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

/** Only reads this app's service status and opens the public system settings screen. */
final class AccessibilitySetup {
    private AccessibilitySetup() {}

    static boolean isEnabled(Context context) {
        AccessibilityManager manager = context.getSystemService(AccessibilityManager.class);
        if (manager == null) return false;
        // Each build has a different applicationId; the Java namespace remains fixed.
        ComponentName expected = new ComponentName(context, ResearchAccessibilityService.class);
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (info.getResolveInfo() == null) continue;
            ServiceInfo service = info.getResolveInfo().serviceInfo;
            if (service != null && expected.equals(new ComponentName(service.packageName, service.name))) {
                return true;
            }
        }
        return false;
    }

    static boolean openSettings(Activity activity) {
        try {
            // Public API: OEM-specific service-detail deep links are not assumed to exist.
            activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return true;
        } catch (ActivityNotFoundException | SecurityException exception) {
            return false;
        }
    }
}
