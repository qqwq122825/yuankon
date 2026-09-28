package org.boundarylab.installer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
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
    private JSONObject config;
    private TextView status;

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
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setPadding(48, 72, 48, 48);

        TextView title = new TextView(this);
        title.setText(getString(R.string.app_name));
        title.setTextSize(24);
        layout.addView(title, matchWrap());

        TextView explanation = new TextView(this);
        explanation.setText("A 包提供首页并携带工作端 B 包。安装由 Android 系统确认；B 包不会出现在桌面。");
        explanation.setTextSize(16);
        explanation.setPadding(0, 24, 0, 24);
        layout.addView(explanation, matchWrap());

        status = new TextView(this);
        status.setText("B 包构建：" + config.optString("payloadBuildId").substring(0, 8));
        status.setPadding(0, 0, 0, 24);
        layout.addView(status, matchWrap());

        Button home = new Button(this);
        home.setText("打开首页");
        home.setOnClickListener(view -> openHomePage());
        layout.addView(home, matchWrap());

        Button install = new Button(this);
        install.setText("安装 B 包");
        install.setOnClickListener(view -> installPayload());
        layout.addView(install, matchWrap());

        Button open = new Button(this);
        open.setText("打开 B 包设置");
        open.setOnClickListener(view -> openPayload());
        layout.addView(open, matchWrap());
        setContentView(layout);
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void installPayload() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
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
            startActivity(intent);
            status.setText("已交给 Android 系统安装器，请在系统界面确认");
        } catch (Exception error) {
            status.setText("B 包校验或系统安装器启动失败，请重新构建 A 包");
        }
    }

    private void openHomePage() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(config.getString("homeUrl"))));
            status.setText("已打开 A 包首页");
        } catch (Exception error) {
            status.setText("首页地址不可用，请重新构建 A 包");
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

    private void openPayload() {
        try {
            startActivity(new Intent("org.boundarylab.screenagent.SETUP")
                    .setPackage(config.getString("payloadPackageName")));
            status.setText("已打开 B 包设置");
        } catch (Exception error) {
            status.setText("尚未安装 B 包，或 B 包版本不匹配");
        }
    }
}
