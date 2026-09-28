package org.boundarylab.installer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;

public final class MainActivity extends Activity {
    private static final String STATE_PREFERENCES = "installer_state";
    private static final String ACCESSIBILITY_AFTER_INSTALL = "accessibility_after_install";

    private JSONObject config;
    private TextView status;
    private WebView webView;
    private boolean waitingForInstallPermission;
    private boolean showingAccessibilityPrompt;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        try (InputStream input = getAssets().open("installer_config.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            copy(input, bytes);
            config = new JSONObject(bytes.toString("UTF-8"));
        } catch (Exception error) {
            throw new IllegalStateException("Installer configuration is invalid", error);
        }

        route();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (config == null) return;
        if (payloadInstalled()) {
            waitingForInstallPermission = false;
            route();
            return;
        }
        if (webView != null) showInstallPrompt();
        if (waitingForInstallPermission
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getPackageManager().canRequestPackageInstalls())) {
            waitingForInstallPermission = false;
            installPayload();
        }
    }

    private void route() {
        if (!payloadInstalled()) {
            if (webView != null || status == null) showInstallPrompt();
            return;
        }
        if (accessibilityPending()) {
            if (payloadAccessibilityEnabled()) {
                getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                        .edit()
                        .putBoolean(ACCESSIBILITY_AFTER_INSTALL, false)
                        .apply();
                showBrowser();
            } else if (!showingAccessibilityPrompt) {
                showAccessibilityPrompt();
            }
            return;
        }
        if (webView == null) showBrowser();
    }

    private boolean accessibilityPending() {
        return getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                .getBoolean(ACCESSIBILITY_AFTER_INSTALL, false);
    }

    private void showInstallPrompt() {
        destroyWebView();
        showingAccessibilityPrompt = false;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setPadding(48, 72, 48, 48);

        TextView title = new TextView(this);
        title.setText(getString(R.string.app_name));
        title.setTextSize(24);
        layout.addView(title, matchWrap());

        TextView explanation = new TextView(this);
        explanation.setText("需要先安装工作端 B 包。安装由 Android 系统确认，安装完成返回后再开启无障碍服务。");
        explanation.setTextSize(16);
        explanation.setPadding(0, 24, 0, 24);
        layout.addView(explanation, matchWrap());

        status = new TextView(this);
        String buildId = config.optString("payloadBuildId");
        status.setText("B 包构建：" + buildId.substring(0, Math.min(8, buildId.length())));
        status.setPadding(0, 0, 0, 24);
        layout.addView(status, matchWrap());

        Button install = new Button(this);
        install.setText("安装 B 包");
        install.setOnClickListener(view -> installPayload());
        layout.addView(install, matchWrap());
        setContentView(layout);
    }

    private void showAccessibilityPrompt() {
        destroyWebView();
        showingAccessibilityPrompt = true;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setPadding(48, 72, 48, 48);

        TextView title = new TextView(this);
        title.setText(getString(R.string.app_name));
        title.setTextSize(24);
        layout.addView(title, matchWrap());

        TextView explanation = new TextView(this);
        explanation.setText("B 包已安装。请在系统设置中开启 B 包的无障碍服务，开启后返回即可进入首页。");
        explanation.setTextSize(16);
        explanation.setPadding(0, 24, 0, 24);
        layout.addView(explanation, matchWrap());

        status = new TextView(this);
        status.setText("等待开启无障碍服务");
        status.setPadding(0, 0, 0, 24);
        layout.addView(status, matchWrap());

        Button accessibility = new Button(this);
        accessibility.setText("打开无障碍");
        accessibility.setOnClickListener(view -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception error) {
                status.setText("系统无障碍设置无法打开，请从系统设置中手动进入");
            }
        });
        layout.addView(accessibility, matchWrap());
        setContentView(layout);
    }

    private void showBrowser() {
        status = null;
        showingAccessibilityPrompt = false;
        destroyWebView();
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP)
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAllowedWebUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isAllowedWebUrl(Uri.parse(url));
            }
        });
        setContentView(webView);
        try {
            webView.loadUrl(config.getString("homeUrl"));
        } catch (Exception error) {
            showInstallPrompt();
            status.setText("首页地址不可用，请重新构建 A 包");
        }
    }

    private boolean isAllowedWebUrl(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme());
    }

    private boolean payloadInstalled() {
        try {
            getPackageManager().getApplicationInfo(config.getString("payloadPackageName"), 0);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private boolean payloadAccessibilityEnabled() {
        try {
            String enabled = Settings.Secure.getString(
                    getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled == null || enabled.isEmpty()) return false;
            String prefix = config.getString("payloadPackageName") + "/";
            for (String component : enabled.split(":")) {
                if (component.regionMatches(true, 0, prefix, 0, prefix.length())) return true;
            }
            return false;
        } catch (Exception error) {
            return false;
        }
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void installPayload() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            waitingForInstallPermission = true;
            status.setText("请允许此安装器安装未知应用，再返回继续");
            startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())));
            return;
        }
        try {
            File payload = payloadFile();
            Uri uri = new Uri.Builder()
                    .scheme("content")
                    .authority(getPackageName() + ".files")
                    .appendPath("payload.apk")
                    .build();
            Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, true)
                    .apply();
            startActivity(intent);
            status.setText("已交给 Android 系统安装器，请在系统界面确认");
        } catch (Exception error) {
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, false)
                    .apply();
            status.setText("B 包校验或系统安装器启动失败，请重新构建 A 包");
        }
    }

    private File payloadFile() throws Exception {
        File directory = new File(getCacheDir(), "payloads");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException();
        File output = new File(directory, "payload.apk");
        try (InputStream input = getAssets().open("payload.apk");
             FileOutputStream target = new FileOutputStream(output)) {
            copy(input, target);
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(output)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format("%02x", value));
        if (!actual.toString().equals(config.getString("payloadSha256")))
            throw new IllegalStateException("Payload digest mismatch");
        return output;
    }

    private static void copy(InputStream input, java.io.OutputStream output) throws Exception {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
    }

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading();
        webView.setWebViewClient(null);
        webView.destroy();
        webView = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        destroyWebView();
        super.onDestroy();
    }
}
