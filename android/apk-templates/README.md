# APK 模板清单与新增版本

## 当前源码

- `android/apk-templates/b-packages/`：工作端版本区。当前 `screenagent-1.7.5/` 有桌面模式选择页；可在 MediaProjection（`VirtualDisplay + ImageReader.acquireLatestImage()`）和 AccessibilityService.takeScreenshot 两种截图模式间切换。MediaProjection 确认仍由 Android 系统界面完成；1.0–1.4 已删除，保留 1.5、1.6、1.7、1.7.1、1.7.2、1.7.3 兼容目录。
- `android/apk-templates/a-packages/`：安装器版本区。当前 `installer-1.2/` 清单 ID 为 `installer-1.2`，有桌面入口和 HTTPS 内置浏览器；构建副本写入首页、最新成功 B 包和摘要配置。未安装 B 包时只显示安装入口；安装成功后，Android 13 及以上可先打开 B 包应用信息并由用户选择「允许受限设置」，再打开无障碍，用户开启与 B 包同名的服务并返回后进入首页；完成首次引导后检测到已安装便直接进入首页。旧 `installer-1.0/1.1` 保留。A 包不复制 B 包工作逻辑。
- `android/apk-templates/standalone/`：不参与 A/B 依赖的独立模板。当前 `browser-1.0/` 只打开可见 WebView。
- `android/apk-templates/templates.json`：后台模板选择框的数据源。显示名和实际 Android 版本分开；当前没有名为 v4.0 的源码，勿只改标题就描述为新增功能。
- `android/apk-templates/domains.json`：可选域名简称映射，不包含凭证。
- `backend/src/apk-builder.js`：复制源码、注入配置、启动 Gradle、检查真实产物。
- `backend/src/build-queue.js`：SQLite 队列、归属检查、构建记录与下载。

## 新增后续模板：复制、改源码、登记

以下命令在项目根目录执行。先确认新目录尚不存在：

```bash
cp -R android/apk-templates/b-packages/screenagent-1.7.4 android/apk-templates/b-packages/screenagent-1.8
```

在新目录修改 Android 源码。向 `android/apk-templates/templates.json` 的数组追加：

```json
{
    "id": "screenagent-1.8",
    "name": "v1.8 · ScreenAgent 新能力",
    "versionName": "1.8.0",
    "versionCode": 9,
    "sourceDir": "b-packages/screenagent-1.8",
    "kind": "screenagent",
    "visibleLauncher": false,
    "description": "在这里写真实新增能力；保留 Android 系统确认与停止入口。"
}
```

保存后刷新构建页面即可出现新选项，无需改 Vue 或重启服务。清单是管理员维护的仓库配置，不是网页上传任意源码/脚本的入口；最多 40 项，ID 唯一，sourceDir 相对 android/apk-templates，且必须位于此目录内。

**同一类模板的约定：**

- A/B 目录表达职责，不表达构建顺序缓存：`b-packages` 是无桌面入口的工作应用；MediaProjection 确认由内部透明 Activity 立即转交 Android 系统界面，所有可见业务界面仍由 A 包承载；`a-packages` 只处理首页、安装、摘要校验和已安装状态切换，不提供 B 包设置入口。A 包构建任务仍从数据库选择同账号最新成功 B 包产物。
- 新增 B 功能时复制 B 版本目录，提高 `versionName/versionCode`，登记新的 `sourceDir`；不要把截图、无障碍视图或设备通信代码加入 A 包。
- `kind` 支持 `screenagent`、`installer` 或 `browser`。新的 Android 架构需要先新增构建适配和测试，不能仅填目录。
- 复制范围为根目录 `build.gradle[.kts]`、`settings.gradle[.kts]`、`gradle.properties`，以及 `app/build.gradle[.kts]`、`app/proguard-rules.pro`、`app/src/`。不复制缓存、签名、local.properties、任意额外模块或符号链接。
- 保留 `app/src/main/res/values/strings.xml` 的 `app_name`；浏览器还需 `home_url`。名称与网址经过 XML/Android 字符串转义，原模板不改。
- ScreenAgent 从 `app/src/main/assets/agent_config.json` 读取后台 `serverUrl` 等运行时参数，不包含 `homeUrl/webUrl`；Gradle 不应再次覆盖这个文件。支持属性 `appId`、`versionName`、`versionCode`。
- ScreenAgent 1.7.5 保留 `boundary-node-v2` 规则并上报节点 text/content_description；页面可切换 MediaProjection 与 takeScreenshot 截图模式，并在设备详情 API 调试会话开启时上报 HTTP/WS、MediaProjection、takeScreenshot 截图延迟、错误元数据，并在本地成功取到 JPEG 后上传私有调试截图内容；关闭调试后停止收录。1.7.5 接收六个固定系统动作和租约内的 `TEXT_INPUT`；TEXT_INPUT 只写入当前聚焦、可编辑、非密码输入框，不接受坐标手势、脚本或通用指令。客户端最多遍历 250 节点 / 24 层，服务端再校验 400 节点 / 32 层和 128 KiB 设备 WS 上限；网页只读取内存中与 viewerId 绑定的最新一帧。
- Installer 从 `app/src/main/assets/installer_config.json` 读取 A 包 HTTPS 首页，以及被锁定的 B 包构建 ID、摘要与包名，并携带 `payload.apk`；这些文件只能由 Node 从已完成构建复制，不接受网页上传或任意路径。1.1 在构建副本的 `<queries>` 中写入 B 包包名并直接检查安装状态，不要求 B 包暴露 Activity；A 包只在自己刚完成 B 包安装的返回路径中显示无障碍引导，用户点击按钮后才打开 Android 系统无障碍设置。
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

把示例替换为实际部署地址。别名解析只写入 APK，不创建域名、DNS、证书或服务器；当前 Node 仍只监听本机。后台域名只写入 B 包，主页 HTTPS URL 只写入 A 包，两者不互相推导。

APK ID 在创建账号时自动分配，一个账号一个固定编号。构建时可不填：填写有效编号归属对应账号，留空或未匹配可用账号时归属默认接收账号（当前为超管）。后端把实际编号写入安装包，记录显示接收账号和匹配结果；构建不创建新编号或改写旧设备归属。没有总台 AppID。工作室/子账号、设备下发、专属域名管理仍是后续阶段。

## 产物与限制

网页构建产物：`backend/.node-private/files/apk-builds/<构建 UUID>/application.apk`。

构建日志：`backend/.node-private/build-work/<UUID>/build.log`，最多 1 MiB。构建记录的“构建日志”按钮通过登录鉴权下载。A/B 两类日志均记录模板路径、包身份、B 包摘要（A 包）、源码准备、Gradle assemble/Lint、`apksigner verify`、`zipalign`、`aapt badging`、桌面入口断言、SHA-256、产物保存、失败和源码清理步骤。构建器按模板 `visibleLauncher` 断言 B 包是否有桌面入口，A 包必须有桌面入口，否则构建直接失败。每次源码副本在成功或失败后清理；异常断电留下的 source 可在确认队列空闲、服务停止后由维护者清理。模板原目录保留。

单实例、单任务执行，最多 10 个未完成任务，每任务 20 分钟；工具链缺失直接报错，执行失败不显示下载按钮。重启将执行中任务标记失败，排队任务继续；提交 requestId 防止网络重试重复建包。不要让两个 Node 实例共用同一数据库和构建目录。

开发签名保存在 `android/.local-tools/android-user/`（或运维指定路径）。产物最多 150 MiB，累计产物配额 2 GiB，构建前磁盘可用空间至少 1 GiB；日志/依赖缓存/异常遗留目录也需运维维护。备份签名才能保持后续升级身份。

「复制链接」复制同源、需超管登录的下载链接，不包含账号 Token，不是匿名公开分享地址。本机链接不适合直接转发到外部手机。Telegram 构建与发送、模板网页上传、图标自定义暂未接入。

1.7.5：基于 1.7.4，开启无障碍与服务重连均不请求 MediaProjection；只在桌面页点击按钮后经进程内单次点击票据校验打开系统授权。页面显示 BuildConfig 版本便于核对实际安装包；取消授权不重试，切换 takeScreenshot 撤销待用票据并停止共享。截图与节点仍按网页实时查看租约正常上报，不依赖调试开关；新增 API 调试上报与私有调试截图内容上传仅用于打开调试后额外记录截图延迟、错误码、授权和上传问题。保留 1.7.4/1.7.3 历史模板。

点击票据的 JVM 行为测试：`bash android/scripts/test-projection-consent.sh`。复用本机已缓存 Kotlin 1.9.22 编译器与 JDK；包含缺失票据、旧 Intent、错误票据、有效点击、重放、取消、连续点击与新点击八项断言。

## ScreenAgent 1.7.6

新增固定模板 `b-packages/screenagent-1.7.6`（versionCode 14），保留 1.7.5。默认 takeScreenshot，MediaProjection 仍仅由用户点击并确认系统共享授权。后端白名单传递 captureReady / projectionActive / captureMode；网页仅在已打开截图浮窗及现有 viewerId 下、就绪/模式/在线状态转换时重发截图请求，不因心跳重复启动。切换模式废弃旧帧回调；停止 MediaProjection 不再误停止 takeScreenshot。首图失败记录调试事件并最多在一分钟间隔后重试两次；有实时会话时首图不争用上传许可。取消授权不重弹，关闭网页后不自动重建实时查看。

验证记录：`backend/.node-private/releases/1.7.6/VERIFICATION.txt`；本机构建命令 `npm run build:screenagent`。编译、合成图联调与真机授权验证分别记录。
