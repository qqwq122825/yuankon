package dev.boundarylab.installer;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;

public final class MainActivity extends Activity {
    private TextView status;
    private Button install;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding * 2, padding, padding);
        TextView title = new TextView(this);
        title.setText("a · 离线安装器"); title.setTextSize(26);
        panel.addView(title);
        TextView description = new TextView(this);
        description.setText("\n内置文件：safe.apk\n应用：边界研究浏览器\n无需联网。安装前请核对系统显示的应用信息。\n\n由 Android 系统确认安装；你可以随时取消。\n");
        description.setTextSize(17); panel.addView(description);
        install = new Button(this); install.setText(R.string.install_button);
        install.setOnClickListener(v -> requestInstall()); panel.addView(install);
        status = new TextView(this); status.setTextSize(15);
        status.setText("准备就绪，点击按钮开始。"); panel.addView(status);
        Button close = new Button(this); close.setText("退出");
        close.setOnClickListener(v -> finish()); panel.addView(close);
        ScrollView scroll = new ScrollView(this); scroll.addView(panel); setContentView(scroll);
    }
    private void requestInstall() {
        if (!getPackageManager().canRequestPackageInstalls()) {
            new android.app.AlertDialog.Builder(this).setTitle("允许此来源安装应用")
                .setMessage("请在系统设置中为 a 开启“允许来自此来源的应用”。返回后再次点击安装按钮。")
                .setNegativeButton("取消", null)
                .setPositiveButton("打开设置", (dialog, which) -> {
                    try {
                        startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())), 10);
                    } catch (RuntimeException e) { status.setText("系统未打开设置，请手动查看应用 a 的安装权限。"); }
                }).show();
            return;
        }
        install.setEnabled(false); status.setText("正在准备并校验内置文件…");
        new Thread(() -> {
            File temp = new File(getFilesDir(), "safe.apk.tmp");
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = getAssets().open("safe.apk"); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        digest.update(buffer, 0, count); output.write(buffer, 0, count);
                    }
                    output.getFD().sync();
                }
                StringBuilder actual = new StringBuilder();
                for (byte b : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
                if (!getString(R.string.payload_sha256).equals(actual.toString())) throw new java.io.IOException("APK checksum mismatch");
                File apk = new File(getFilesDir(), "safe.apk");
                if (!temp.renameTo(apk)) throw new java.io.IOException("APK preparation failed");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    install.setEnabled(true);
                    Uri uri = Uri.parse("content://" + getPackageName() + ".apk/safe.apk");
                    Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.setClipData(ClipData.newRawUri("safe.apk", uri));
                    try {
                        startActivityForResult(intent, 11);
                        status.setText("已打开系统安装界面，请按系统提示确认或取消。");
                    } catch (RuntimeException e) { status.setText("系统安装界面启动失败，请检查设备安装策略后重试。"); }
                });
            } catch (Exception e) {
                temp.delete();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    install.setEnabled(true); status.setText("文件准备失败，请重新获取安装器后重试。");
                });
            }
        }, "prepare-apk").start();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 10) status.setText(getPackageManager().canRequestPackageInstalls()
            ? "安装来源已允许，请再次点击安装。" : "安装来源尚未开启，可以重试或退出。");
        if (request == 11) status.setText("已返回安装器。安装结果请以系统提示为准；可在桌面查找目标应用。");
    }
}
