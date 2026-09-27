# 本地 Android 构建与机器人状态

## 当前状态

PHP 构建控制器、机器人轮询和队列随旧后台移除。**Node 已支持网页发起的真实 APK 构建队列、状态、下载与复制链接；机器人配对与 Telegram 发送仍待接入。** 没有后台旧 Worker 可启动，不把历史成功状态或测试夹具当作新构建完成。

网页操作与新增模板见 [模板指南](../../android/apk-templates/README.md)。网页使用 `backend/src/build-queue.js` 与 `apk-builder.js`，并非调用下述无参数 CLI 脚本。

以下本地资产保留：

- `android/apk-templates/browser-1.0/` 固定原生 Activity + WebView 浏览器模板；可见主页、刷新/返回、可跳过的无障碍状态引导。
- `android/.local-tools/` 中既有 JDK、SDK、Gradle、离线依赖和签名材料。
- 历史 APK 已移至 `backend/.node-private/files/apk-builds/`，数据库保留原相对路径；文件经超管鉴权下载。
- 既有 `android/apk-repack/`、`android/apk-shield/`、`android/installer/` 与相关脚本保留，不由 Node 自动调用。

原浏览器模板仅申请 INTERNET；无障碍服务事件掩码为 0，窗口、截图、手势和按键过滤能力关闭。未加入手机上线、采集、远程操作或机器人登录验证码。

## 独立模板构建

```bash
npm run build:apk
# 等同于 bash android/scripts/build-browser.sh
```

脚本先检查本地工具，再将固定模板复制至新建的 `android/dist/browser-template-*/source`，使用离线模式运行 `assembleDebug lintDebug`，随后执行 apksigner 与 zipalign 验证，保存 APK、SHA-256 与日志。失败直接以非零状态退出，不覆盖既有构建目录、不修改模板。使用模板默认名称/主页/applicationId，不提供任意脚本输入。

默认工具链：JDK 17、Gradle 8.11.1、AGP 8.9.2、Android API 35、Build Tools 35.0.0。本地依赖已保留。其他机器需要先准备这些工具和 Gradle 缓存；离线脚本不自动安装全局软件或下载工具。

可通过环境变量指定已安装路径：

```bash
JAVA_HOME=/absolute/jdk17 \
ANDROID_HOME=/absolute/android-sdk \
GRADLE=/absolute/gradle-8.11.1/bin/gradle \
npm run build:apk
```

另支持 `GRADLE_USER_HOME` 与 `ANDROID_USER_HOME`，默认仍使用 `android/.local-tools`。开发签名保留在私有工具目录，勿上传。模板源码、Gradle 文件可以进 Git；APK、缓存、签名和构建目录已忽略。

编译、签名验证、Telegram 送达、真机运行是独立验收项。本地脚本仅验证构建，不推送 Telegram，不向设备安装，也不创建后台构建记录。Android 启动行为和真机待验收清单见 [ANDROID_STARTUP.md](ANDROID_STARTUP.md)。

## 后续机器人接入要求（未实施）

应用名、图标、HTTPS 主页作为校验后的数据；固定模板，进程参数数组；独立构建队列；机器人 Token 加密保存；一次性配对后仅受理私聊；真实签名验证通过后回传实际 APK。限制图标大小/像素、任务数量、超时与磁盘占用。总台机器人验证码属于另一个流程，见 [ACCOUNT_DESIGN.md](ACCOUNT_DESIGN.md)。

## 2026-09-28 网页构建验收

- `npm run check`：格式、Vite 编译、56 项 Node 测试通过。
- `npm run test:e2e`：11 项 Chromium 测试通过；表单/失败/下载/复制/窄窗口自动化使用明确标注的合成文件，未冒充 APK。
- 另通过实际 8080 HTTP 构建队列完成两次真实离线编译、Lint、apksigner、zipalign、包名/版本检查，并从鉴权下载接口读回校验 SHA-256：
  - ScreenAgent：`cdf74a15-cb13-45ce-a5f8-81d21d470b08`，APP 名 Rivo TV，包名 org.helper.scannertask，APK ID 10074，空批次，域名 local；3,729,456 字节，SHA-256 `c15901cae4af3f8fbb70a5e2265d8d6da26979f71cc2e86985905ef6953d5293`。
  - 浏览器：`62b8126e-79b7-4a24-a493-9f263acd5cc9`，随机包名、含引号/中文/与号的名称与带查询参数主页；18,046 字节，SHA-256 `2dc8eed2adeee4b1ab1b775873a61b5a0f059350e205cbaa4fd3c66d1f6516a7`。
- 实际产物在 `backend/.node-private/files/apk-builds/<上述 UUID>/application.apk`，构建中心可下载。核对 APK 内 agent_config.json 与编译资源，确认后台地址/首页/APK ID/批次/包名/构建 ID 已写入。
- SQLite 升级前完成在线备份，6 台设备、5 条快照与 4 条旧构建保留，新增 2 条真实构建；外键检查无错误。
- 两个 APK 均为开发签名；adb 未发现连接设备，未安装或验证真机运行。未做 Telegram 发送或外部部署，cohuducox 尚未配置实际域名映射。
