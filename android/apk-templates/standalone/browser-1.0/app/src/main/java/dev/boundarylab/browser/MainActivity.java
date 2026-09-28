package dev.boundarylab.browser;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Visible HTTPS browser with optional service setup; no collection or backend pairing. */
public final class MainActivity extends Activity {
    private static final String GUIDE_HANDLED = "guide_handled";
    private WebView browser;
    private TextView address;
    private TextView status;
    private TextView researchStatus;
    private AlertDialog setupDialog;
    private boolean guideHandled;
    private boolean settingsRequested;
    private boolean loadFailed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        guideHandled = state != null && state.getBoolean(GUIDE_HANDLED);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        Button home = new Button(this);
        home.setText("首页");
        home.setOnClickListener(view -> browser.loadUrl(getString(R.string.home_url)));
        toolbar.addView(home);
        address = new TextView(this);
        address.setTextSize(12); address.setTextColor(Color.DKGRAY); address.setMaxLines(2);
        toolbar.addView(address, new LinearLayout.LayoutParams(0, -2, 1));
        Button refresh = new Button(this);
        refresh.setText("刷新"); refresh.setOnClickListener(view -> browser.reload());
        toolbar.addView(refresh);
        root.addView(toolbar);
        status = new TextView(this);
        status.setTextSize(12); status.setPadding(16, 8, 16, 8);
        status.setText("浏览器就绪");
        root.addView(status);
        researchStatus = new TextView(this);
        researchStatus.setTextSize(12);
        researchStatus.setTextColor(Color.rgb(64, 76, 190));
        researchStatus.setPadding(16, 12, 16, 12);
        researchStatus.setBackgroundColor(Color.rgb(241, 243, 255));
        researchStatus.setFocusable(true);
        researchStatus.setOnClickListener(view -> showAccessibilityGuide());
        root.addView(researchStatus);
        browser = new WebView(this);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!"https".equalsIgnoreCase(request.getUrl().getScheme())) {
                    status.setText("此版本只打开 HTTPS 页面。"); return true;
                }
                return false;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
                address.setText(Uri.parse(url).getHost()); status.setText("正在加载网页…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!loadFailed) status.setText("浏览器就绪");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { loadFailed = true; status.setText("页面加载异常，请检查网址或网络后刷新。"); }
            }
        });
        root.addView(browser, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (state == null || browser.restoreState(state) == null) {
            browser.loadUrl(getString(R.string.home_url));
        }
    }

    private void showAccessibilityGuide() {
        if (isFinishing() || (setupDialog != null && setupDialog.isShowing())) return;
        boolean enabled = AccessibilitySetup.isEnabled(this);
        settingsRequested = false;
        setupDialog = new AlertDialog.Builder(this)
            .setTitle(R.string.accessibility_guide_title)
            .setMessage(enabled ? getString(R.string.accessibility_enabled_message)
                : getString(R.string.accessibility_guide_message, getString(R.string.app_name)))
            .setPositiveButton(R.string.accessibility_open_settings, (dialog, which) -> {
                guideHandled = true;
                settingsRequested = true;
                if (!AccessibilitySetup.openSettings(this)) {
                    settingsRequested = false;
                    Toast.makeText(this, getString(R.string.accessibility_settings_missing,
                        getString(R.string.app_name)), Toast.LENGTH_LONG).show();
                }
            })
            .setNegativeButton(enabled ? R.string.accessibility_continue_browsing
                : R.string.accessibility_browse_only, (dialog, which) -> guideHandled = true)
            .setOnCancelListener(dialog -> guideHandled = true)
            .create();
        setupDialog.setCanceledOnTouchOutside(false);
        setupDialog.show();
    }

    @Override public void onBackPressed() { if (browser.canGoBack()) browser.goBack(); else super.onBackPressed(); }
    @Override protected void onPause() { browser.onPause(); super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        if (browser == null) return;
        browser.onResume();
        boolean enabled = AccessibilitySetup.isEnabled(this);
        researchStatus.setText(enabled ? R.string.accessibility_status_enabled
            : R.string.accessibility_status_disabled);
        if (enabled) {
            guideHandled = true;
            if (setupDialog != null) setupDialog.dismiss();
        } else if (!guideHandled) {
            showAccessibilityGuide();
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        // A rotation restores an unanswered guide, but returning from Settings never loops it.
        state.putBoolean(GUIDE_HANDLED, guideHandled || settingsRequested);
        browser.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        if (setupDialog != null) setupDialog.dismiss();
        browser.destroy();
        super.onDestroy();
    }
}
