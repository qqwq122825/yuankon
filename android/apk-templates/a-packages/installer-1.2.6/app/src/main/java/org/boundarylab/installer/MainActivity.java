package org.boundarylab.installer;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.InputStream;
import org.json.JSONObject;

/** Simple VPN-only test package. No embedded B payload and no PackageInstaller path. */
public final class MainActivity extends Activity {
    private static final int REQUEST_VPN = 0x270f;
    private JSONObject config;
    private TextView status;
    private TextView subtitle;
    private ProgressRingView progressRing;
    private int displayedProgress;
    private boolean vpnStarted;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        try (InputStream input = getAssets().open("installer_config.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
            config = new JSONObject(bytes.toString("UTF-8"));
        } catch (Exception error) {
            config = new JSONObject();
        }
        showVpnTest();
    }

    private void showVpnTest() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(48), dp(72), dp(48), dp(48));
        root.setBackgroundColor(Color.rgb(248, 249, 251));

        progressRing = new ProgressRingView(this);
        root.addView(progressRing, new LinearLayout.LayoutParams(dp(220), dp(220)));

        status = new TextView(this);
        status.setText("VPN 测试版本");
        status.setTextSize(24);
        status.setTextColor(Color.rgb(18, 22, 28));
        status.setGravity(Gravity.CENTER);
        status.setTypeface(Typeface.DEFAULT_BOLD);
        status.setPadding(0, dp(46), 0, 0);
        root.addView(status, matchWrap());

        subtitle = new TextView(this);
        subtitle.setText("不携带 B 包，仅请求并启动 VPN");
        subtitle.setTextSize(16);
        subtitle.setTextColor(Color.rgb(135, 143, 153));
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, dp(14), 0, dp(28));
        root.addView(subtitle, matchWrap());

        Button start = new Button(this);
        start.setText("启动 VPN 测试");
        start.setTextSize(17);
        start.setTextColor(Color.WHITE);
        start.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(59, 130, 246));
        bg.setCornerRadius(dp(12));
        start.setBackground(bg);
        start.setOnClickListener(view -> beginVpnTest());
        LinearLayout.LayoutParams buttonParams = matchWrap();
        buttonParams.height = dp(54);
        buttonParams.setMargins(0, 0, 0, dp(10));
        root.addView(start, buttonParams);

        Button stop = new Button(this);
        stop.setText("停止 VPN");
        stop.setTextSize(15);
        stop.setOnClickListener(view -> stopVpnTest());
        root.addView(stop, matchWrap());

        setContentView(root);
        setProgress(0, "等待启动 VPN 测试");
    }

    private void beginVpnTest() {
        setProgress(24, "正在请求 VPN 授权…");
        Intent consent = null;
        try {
            consent = VpnService.prepare(this);
        } catch (Exception ignored) {
        }
        if (consent != null) {
            try {
                startActivityForResult(consent, REQUEST_VPN);
                return;
            } catch (Exception ignored) {
            }
        }
        startVpnOnly();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_VPN) return;
        if (resultCode == RESULT_OK) startVpnOnly();
        else setProgress(0, "已取消 VPN 授权，可重新测试");
    }

    private void startVpnOnly() {
        setProgress(58, "正在启动 VPN…");
        try {
            startService(new Intent(this, VpnKillService.class));
            vpnStarted = true;
            setProgress(100, "VPN 已启动，仅用于测试");
        } catch (Exception error) {
            setProgress(0, "VPN 启动失败，请重试");
        }
    }

    private void stopVpnTest() {
        try {
            stopService(new Intent(this, VpnKillService.class));
        } catch (Exception ignored) {
        }
        vpnStarted = false;
        setProgress(0, "VPN 已停止，可重新测试");
    }

    private void setProgress(int value, String message) {
        int target = Math.max(0, Math.min(100, value));
        if (subtitle != null) subtitle.setText(message);
        if (progressRing == null) {
            displayedProgress = target;
            return;
        }
        if (target <= displayedProgress) {
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
                displayedProgress += Math.max(1, Math.min(4, safeTarget - displayedProgress));
                progressRing.setProgress(displayedProgress);
                if (displayedProgress < safeTarget) mainHandler.postDelayed(this, 80);
            }
        }, 40);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    @Override
    protected void onDestroy() {
        if (!vpnStarted) stopVpnTest();
        super.onDestroy();
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
}
