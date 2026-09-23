package dev.boundarylab.browser;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.accessibility.AccessibilityEvent;

/** Status/onboarding fixture only. No events, nodes, screenshots, gestures, or reporting. */
public final class ResearchAccessibilityService extends AccessibilityService {
    @Override protected void onServiceConnected() {
        AccessibilityServiceInfo info = getServiceInfo();
        if (info == null) return;
        // No event mask in XML defaults to zero; keep this explicit at runtime as well.
        info.eventTypes = 0;
        info.packageNames = new String[] { getPackageName() };
        setServiceInfo(info);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        // Event content is never read or retained.
    }

    @Override public void onInterrupt() {
        // No ongoing collection or feedback to interrupt.
    }
}
