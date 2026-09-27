# a · 离线安装器

独立 Android 原生小应用，内置仓库根目录的 `safe.apk`。不改浏览器模板、Telegram 构建、PHP 页面或设备接口。开发签名 APK，Android 8.0 / API 26 起。

## 使用

1. 将 `dist/offline-installer/a.apk` 传到测试手机，用系统安装界面安装 a。
2. 打开 a，点击「安装 safe.apk」。
3. 首次按提示进入系统设置，为 a 开启「允许来自此来源的应用」，返回后再次点击安装。
4. 在 Android 安装界面核对「边界研究浏览器」，确认或取消。
5. 安装结果以系统提示为准，在桌面打开目标应用。卸载 a 不会卸载目标应用。

a 没有联网、存储、无障碍或后台服务权限，只声明 `REQUEST_INSTALL_PACKAGES`。目标 APK 保持原有签名及权限不变。没有静默安装，也不自动点击系统提示。安装来源受设备管理员或厂商策略限制时由系统处理。

## 构建与部署

从仓库根目录执行 `bash scripts/build-offline-installer.sh`。复用 `.local-tools` 的 JDK 17、SDK 35、Gradle 8.11.1 和已有离线缓存，不修改全局环境。可用 JAVA_HOME、ANDROID_HOME、GRADLE 指定工具链。

脚本先验证输入签名和本次约定的包名，再复制原文件至被 Git 忽略的 assets；生成 SHA-256 资源，执行 assembleDebug / lintDebug，验证产物签名和对齐，并逐字节核对嵌入文件。输入错误或依赖缺失时构建中止，不下载未知依赖。

输出 `dist/offline-installer/a.apk` 和 `a.json`；产物、内置 APK、生成资源、构建目录均忽略。开发证书保存在本机私有 Android 工具目录，不作为生产发行密钥。迁移时重新准备工具链及输入 APK；保留证书才能覆盖更新已有 a。

## 文件交付协议

无服务端或设备 API 变更。点击时把 assets/safe.apk 写入应用私有目录，SHA-256 一致才发布文件。仅分享 `content://dev.boundarylab.installer.a.apk/safe.apk`，通过 Intent 临时授予只读访问；Provider 不导出、拒绝其他路径及写入。由系统安装器完成安装，返回页面不伪报安装成功。目标应用签名冲突、版本限制和取消均由系统提示处理。

## 验收

2026-09-25：真实编译、Android Lint、apksigner、zipalign、嵌入文件一致性通过；后端回归 67 项 / 584 断言通过。本机 adb 当前无连接设备，以下项目待手机验证：

- 首次开启安装来源、拒绝权限、返回后重试。
- 安装确认、取消、成功后从桌面启动。
- 已安装同签名版本与异签名版本时的系统反馈。
- 横竖屏、退出重进、不同厂商系统。

构建结果不代表真机运行验收完成。
