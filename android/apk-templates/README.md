# APK 模板清单与新增版本

## 当前源码

- `android/apk-templates/screenagent-1.0/`：单张截图接入模板，清单 ID `screenagent-1.0`。用户在手机确认共享后发送一张截图；登记码、Token 不打进 APK。
- `android/apk-templates/browser-1.0/`：浏览器基础模板，清单 ID `browser-1.0`。只打开可见 WebView；APK ID/后台地址作为构建元数据保存，不让该模板产生设备接入能力。
- `android/apk-templates/templates.json`：后台模板选择框的数据源。显示名和实际 Android 版本分开；当前没有名为 v4.0 的源码，勿只改标题就描述为新增功能。
- `android/apk-templates/domains.json`：可选域名简称映射，不包含凭证。
- `backend/src/apk-builder.js`：复制源码、注入配置、启动 Gradle、检查真实产物。
- `backend/src/build-queue.js`：SQLite 队列、归属检查、构建记录与下载。

## 新增 1.1 模板：复制、改源码、登记

以下命令在项目根目录执行。先确认新目录尚不存在：

```bash
cp -R android/apk-templates/screenagent-1.0 android/apk-templates/screenagent-1.1
```

在新目录修改 Android 源码，保留旧 1.0 目录。向 `android/apk-templates/templates.json` 的数组追加：

```json
{
  "id": "screenagent-1.1",
  "name": "v1.1 · ScreenAgent 单张截图",
  "versionName": "1.1.0",
  "versionCode": 2,
  "sourceDir": "screenagent-1.1",
  "kind": "screenagent",
  "description": "在这里写真实新增能力；保留手机确认与停止入口。"
}
```

保存后刷新构建页面即可出现新选项，无需改 Vue 或重启服务。清单是管理员维护的仓库配置，不是网页上传任意源码/脚本的入口；最多 40 项，ID 唯一，sourceDir 相对 android/apk-templates，且必须位于此目录内。

**同一类模板的约定：**

- `kind` 仅支持 `screenagent` 或 `browser`。新的 Android 架构需要先新增构建适配和测试，不能仅填目录。
- 复制范围为根目录 `build.gradle[.kts]`、`settings.gradle[.kts]`、`gradle.properties`，以及 `app/build.gradle[.kts]`、`app/proguard-rules.pro`、`app/src/`。不复制缓存、签名、local.properties、任意额外模块或符号链接。
- 保留 `app/src/main/res/values/strings.xml` 的 `app_name`；浏览器还需 `home_url`。名称与网址经过 XML/Android 字符串转义，原模板不改。
- ScreenAgent 从 `app/src/main/assets/agent_config.json` 读取运行时参数，Gradle 不应再次覆盖这个文件。支持属性 `appId`、`versionName`、`versionCode`。
- 浏览器支持 `shellApplicationId`、`shellVersionName`、`shellVersionCode`，元数据写入 `assets/build_config.json`，主页写入 `home_url`。
- 输出约定 `app/build/outputs/apk/debug/app-debug.apk`；固定执行 `assembleDebug lintDebug`。保持 JDK 17、AGP 8.9.2 / Gradle 8.11.1 与 API 35 工具链兼容。
- 参数不写入 Java/Kotlin/Gradle 源代码；包名、版本是白名单属性。包名是 applicationId，不全局替换 namespace 或 Java/Kotlin 包路径。
- 升级安装须保持包名与签名、提升 versionCode。随机包名产生独立应用，不是旧应用升级。
- 开始运行时复制源码，队列保存模板清单快照；已发布目录不要原地改版本，新增目录维护，已有产物保持不变。

新增依赖须由维护者预先准备离线缓存。后台只离线构建，不从提交参数中下载代码或执行用户脚本。新增版本先执行 `npm run check`、`npm run test:e2e`，再在页面真实构建、核对参数/签名并做真机验证。

## 域名与 APK ID

`local` 自动解析为当前本地服务 origin，例如 `http://127.0.0.1:8080`。USB 联调另执行 `adb reverse tcp:8080 tcp:8080`，不是远程公网地址。

填写 `https://console.example.com` 或 `console.example.com` 会保存为 HTTPS origin（不携带路径、账号、查询串）。仅写 `cohuducox` 时，需要维护者先在 `domains.json` 配置，例如以下**示例地址**：

```json
{ "cohuducox": "https://console.example.com" }
```

把示例替换为实际部署地址。别名解析只写入 APK，不创建域名、DNS、证书或服务器；当前 Node 仍只监听本机。主页 HTTPS URL 与后台域名是两项独立参数。

首次提交会把新的 APK ID 绑定到当前超管；已有 APK ID 的归属不能被构建参数改写。没有总台 AppID。工作室/子账号、设备下发、专属域名管理仍是后续阶段。

## 产物与限制

网页构建产物：`backend/.node-private/files/apk-builds/<构建 UUID>/application.apk`。

构建日志：`backend/.node-private/build-work/<UUID>/build.log`，最多 1 MiB，不通过 API 公开。每次源码副本在成功或失败后清理；异常断电留下的 source 可在确认队列空闲、服务停止后由维护者清理。模板原目录保留。

单实例、单任务执行，最多 10 个未完成任务，每任务 20 分钟；工具链缺失直接报错，执行失败不显示下载按钮。重启将执行中任务标记失败，排队任务继续；提交 requestId 防止网络重试重复建包。不要让两个 Node 实例共用同一数据库和构建目录。

开发签名保存在 `android/.local-tools/android-user/`（或运维指定路径）。产物最多 150 MiB，累计产物配额 2 GiB，构建前磁盘可用空间至少 1 GiB；日志/依赖缓存/异常遗留目录也需运维维护。备份签名才能保持后续升级身份。

「复制链接」复制同源、需超管登录的下载链接，不包含账号 Token，不是匿名公开分享地址。本机链接不适合直接转发到外部手机。Telegram 构建与发送、模板网页上传、图标自定义暂未接入。
