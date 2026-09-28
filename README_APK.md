# APK 模板位置与开发指南

## 1. 统一模板目录

项目根目录是 `/Users/xxx/Documents/code/yuankon`。当前登记四个模板：

- `android/apk-templates/b-packages/screenagent-1.2/`：当前 B 包工作端；无桌面图标，由 A 包打开设置，支持无障碍开启首图和网页租约内实时最新帧截图。`screenagent-1.1` 保留为按需单张版。
- `android/apk-templates/b-packages/screenagent-1.0/`：保留的旧 B 包单次手动截图版本，不原地覆盖。
- `android/apk-templates/a-packages/installer-1.0/`：A 包桌面安装器；只负责携带队列选定的最新 B 包并调用系统安装确认。
- `android/apk-templates/standalone/browser-1.0/`：原 android-shell 浏览器源码，不参与 A/B 依赖关系。

`android/apk-templates/templates.json` 是后台版本清单；`sourceDir` 相对此清单所在目录。这样目录里放的就是模板源码，不再只有配置文件。完整约定见 [模板指南](android/apk-templates/README.md)。

Vue 前端在 `frontend/src/`；Node 服务器在 `backend/src/`。手机不是 Vue 页面封装：浏览器模板为 Java + WebView，ScreenAgent 为 Kotlin 原生应用。

## 2. 新增后续模板

在项目根目录执行；先确认目标目录不存在：

```bash
cp -R android/apk-templates/b-packages/screenagent-1.2 android/apk-templates/b-packages/screenagent-1.3
```

修改新目录中的功能，再往 `android/apk-templates/templates.json` 数组追加：

```json
{
  "id": "screenagent-1.2",
  "name": "v1.2 · 截图模板",
  "versionName": "1.2.0",
  "versionCode": 3,
  "sourceDir": "b-packages/screenagent-1.2",
  "kind": "screenagent",
  "description": "填写此版本实际新增的功能。"
}
```

保存后刷新构建页。也可采用 `screenshot-1.1` 等清晰的英文目录名，和 sourceDir 一致即可。`kind` 支持 `browser`、`screenagent`、`installer`；新增构建结构需先增加适配和测试。

**版本升级保留旧目录。** 安装包升级需相同 applicationId/签名、提高 versionCode；随机包名是独立应用。当前实际模板为 1.1，不把改标题当作实现更高版本功能。

## 3. 在哪里改功能

| 功能 | 相对模板目录的路径 |
|---|---|
| 名称 | `app/src/main/res/values/strings.xml` 的 app_name |
| 浏览器主页、导航 | `app/src/main/java/dev/boundarylab/browser/MainActivity.java`、strings.xml 的 home_url |
| 浏览器开关状态引导 | `AccessibilitySetup.java`、`ResearchAccessibilityService.java` 与 res/xml 配置 |
| ScreenAgent 页面/登记 | `app/src/main/java/com/zaka/screenagent/MainActivity.kt`、net/DeviceSession.kt |
| ScreenAgent 首图与实时最新帧 | `accessibility/BoundaryAccessibilityService.kt`、`net/AgentSocket.kt`、`net/HttpUploader.kt`、`capture/CaptureService.kt` |
| ScreenAgent 运行配置 | `app/src/main/assets/agent_config.json` |
| 权限与组件声明 | `app/src/main/AndroidManifest.xml` |
| 版本、SDK、包名属性 | `app/build.gradle` 或 `app/build.gradle.kts` |

安装包名与 namespace / Java / Kotlin 包路径分开，不全局替换源码包名。网页构建在独立私有副本中写入转义后的资源/JSON，包名和版本走白名单 Gradle 属性；不修改原模板。

ScreenAgent 1.1 的无障碍服务在用户显式开启后自动发送首图；网页查看只在有效租约内请求一张，租约关闭或过期即停止。Android 10 及以下的 CaptureController/MediaProjection 兼容路径仍由手机确认后仅发送一张，维持可见状态与停止入口。浏览器模板只保存接入元数据，不调用登记或采集接口。新增功能涉及两端时，同时更新 backend 协议/认证与 frontend 页面，分别测试。

## 4. 构建与产物

```bash
npm run build:apk
npm run build:screenagent
```

命令从根目录执行，脚本在 `android/scripts/`。CLI 每次新建 `android/dist/browser-template-*/` 或 `android/dist/screenagent-*/`，复制源码、离线编译/Lint、验证签名及对齐、计算 SHA-256。不覆盖旧产物，不向手机安装。

网页 [构建中心](http://127.0.0.1:8080/builds) 先选择 B 包版本并构建，再选择 A 包版本构建。B 包接收后台域名、APP 名、可选 APK ID/批次/包名，不接收首页；A 包接收名称、HTTPS 首页地址和包名。服务端按同项目、同归属账号选取最新成功且文件仍存在的 B 包，固定记录 B 构建 ID、SHA-256 与包名。没有可用 B 包时 A 包返回 409；两者包名相同时返回 422。A 包构建副本写入 `assets/payload.apk` 和带首页地址的 `installer_config.json`，并在复制前校验摘要。B 包必须没有 MAIN/LAUNCHER，A 包必须有桌面入口，真实构建在 `aapt badging` 阶段强制校验。产物在 `backend/.node-private/files/apk-builds/<UUID>/application.apk`；详细日志在 `backend/.node-private/build-work/<UUID>/build.log`，构建记录可鉴权下载，包含 Gradle/Lint、签名、对齐、包信息、摘要及产物保存步骤。完成或失败的记录可在列表确认后删除，服务端同时永久删除该 UUID 的记录、APK 目录与构建日志目录；排队中或构建中的任务不可删除，B 包正被活动 A 包使用时也不可删除。

工具链在 `android/.local-tools/`：JDK 17、Gradle 8.11.1、AGP 8.9.2、Android API 35。支持 JAVA_HOME、ANDROID_HOME、GRADLE、GRADLE_USER_HOME、ANDROID_USER_HOME。离线依赖由维护者预先准备；开发签名和缓存不进 Git。

## 5. 域名、归属与其他目录

- 首页 URL 只属于有桌面入口的 A 包；后台域名只属于无桌面入口的 B 包，二者独立。
- `local` 是本机 USB 联调地址；域名简称在 `android/apk-templates/domains.json` 映射到真实 HTTPS 地址，保存配置不等于部署域名。
- APK ID 在创建账号的事务中自动分配，一个账号一个固定编号；不是账号凭证。构建填写有效编号归属对应账号，留空或未匹配可用账号时使用默认接收账号的编号（当前为超管）。构建记录显示实际编号、接收账号与匹配结果，不因构建创建新编号。构建 UUID 表示一次任务，没有总台 AppID。
- 手机首次登记仍需要临时登记码，入口在「账号设置 → 设备接入调试」，与公开的 APK ID 分开。
- `android/installer/`、`android/apk-repack/`、`android/apk-shield/` 是保留的独立工具，未纳入网页模板队列。
- `android/inputs/` 保留原有输入 APK；`android/dist/` 是 CLI 产物。两者不是主源码。

## 6. 验收清单

- 修改版本模板，而非一次性构建副本；登记正确的版本与源码目录。
- 执行 `npm run check`、`npm run test:e2e`；模板或构建脚本变更后真实打包、Lint、校验签名/包名/版本/资源。
- 在登记的测试手机安装后检查启动、确认、停止、返回、旋转、断网等；不把编译或下载成功等同真机成功。
- 提交前排除 node_modules、.node-private、.local-tools、dist、APK、密钥与缓存。

相关：[ScreenAgent 接入](backend/docs/SCREENAGENT_INGRESS.md) · [构建说明](backend/docs/BUILD_BOT.md) · [目录迁移](backend/docs/DIRECTORY_LAYOUT.md)。
