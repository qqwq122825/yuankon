# 本地 Android 构建与机器人状态

## 当前状态

PHP 构建控制器、机器人轮询和队列随旧后台移除。**Node 已支持网页发起的真实 APK 构建队列、状态、下载与复制链接；机器人配对与 Telegram 发送仍待接入。** 没有后台旧 Worker 可启动，不把历史成功状态或测试夹具当作新构建完成。

网页操作与新增模板见 [模板指南](../../android/apk-templates/README.md)。网页使用 `backend/src/build-queue.js` 与 `apk-builder.js`，并非调用下述无参数 CLI 脚本。

网页流程分为 A/B 两类。先构建当前 `screenagent-1.2` B 包：它没有桌面图标，保留可见设置页和登记，在用户显式开启无障碍后上报首图，随后只在网页有效查看租约内串行上传实时最新帧；`screenagent-1.1` 保留按需单张，`screenagent-1.0` 保留手动单次。随后构建 `installer-1.0` A 包：队列按同项目、同归属账号自动选择最新成功且文件存在的 B 包，记录其构建 ID、SHA-256 和包名，并把 APK 复制到 A 包私有源码副本的 `assets/payload.apk`。A 包有桌面入口，运行时校验内置 B 包摘要并调用 Android 系统安装器；安装仍由用户在系统界面确认，不执行静默安装。

模板目录按职责分为 `b-packages/`、`a-packages/`、`standalone/`。设备侧新能力只增加 B 包版本；A 包保持安装和启动职责。构建页分别提供 A/B 版本选择。每次 A/B 构建的私有 `build.log` 都记录模板/包身份、B 包摘要、Gradle assemble + Lint、apksigner 签名校验、zipalign 对齐校验、aapt 包信息、SHA-256 和产物保存结果，并可从构建记录鉴权下载。

以下本地资产保留：

- `android/apk-templates/standalone/browser-1.0/` 固定原生 Activity + WebView 浏览器模板；可见主页、刷新/返回、可跳过的无障碍状态引导。
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

## 2026-09-28 账号固定 APK ID 与默认归属验收

- 账号创建时自动分配单一固定 APK ID；默认超管 mtx 的规范编号为 `1`，旧 `10074` 路由保留用于已安装 APK 兼容。留空或未匹配可用账号时使用默认接收账号（当前为超管）；构建不新建路由。总台/子账号回落规则见 ACCOUNT_DESIGN.md，随多租户账号阶段实施。
- `npm run check`：格式、前端构建、66 项 Node 测试通过。覆盖自动分配/唯一性/回滚/旧映射迁移、空值/省略/不存在/停用/到期/跨项目/旧别名、幂等归属及登记凭证隔离。
- `npm run test:e2e`：14 项 Chromium 测试通过，包括账号单编号、构建空值及错误编号回落、无手动建号区域、账号页登记调试、键盘与窄窗口桌面布局。自动化下载仍使用明确标注的合成文件。
- 另在实际 Chrome 后台留空 APK ID 提交 ScreenAgent 真实构建：`48346429-e7aa-4074-99b0-18ee514de08e`，APP「归属验证」，local，HTTPS 首页 example.com，批次 default-owner-20260928，随机包名 `org.boundary.app.pc3eb62cc816c9a89`。
- Gradle 编译/Lint、签名与对齐校验通过，浏览器下载成功。产物 3,729,536 字节，SHA-256 `aba974df07f3d4d7c7bf11270e19e0592d04d0e4af1177baaf4352791b799978`。从下载 APK 的 `assets/agent_config.json` 读回实际 `apkId: "10074"`，数据库保留空填写值、`owner_username: "mtx"`、`routing_reason: "default_empty"`。
- 升级前 SQLite 在线备份在私有 backups 目录；旧设备、快照、账号、路由、构建的原字段逐项比对一致，外键检查通过。未向手机安装，此次不代表真机上报验收；无外部部署或新增 Git 提交/推送。

## 2026-09-28 A/B 包流程验收

- 构建中心已拆分为 B 包工作端和 A 包安装器。服务端迁移 `010_ab_package_builds` 保存 `artifact_role` 以及 A 包锁定的 `payload_build_id/payload_sha256/payload_package_name`；A 包没有可用 B 包时拒绝提交。
- `npm run check`：格式、Vue 构建与 70 项 Node 测试通过；`npm run test:e2e`：14 项 Chromium 测试通过，覆盖先 B 后 A、最新 B 摘要展示、记录类型和内置 B 关联。浏览器队列产物仍是明确标注的合成文件。
- 使用 Node 实际 builder 完成两个开发签名 APK：B 包 `org.boundarylab.worker.verification`，3,729,460 字节，SHA-256 `64dbfa6af9e8728a03ab8aae4c5cb269466c80d5d467f4d8e431202c312e9362`；A 包 `org.boundarylab.installer.verification`，3,447,966 字节，SHA-256 `472926715ee7b0878aaff813c8da2137481f3431d42a927eed3e170daacc9e54`。
- 两个 APK 均通过 `apksigner verify --verbose` 和 `zipalign -c -P 16 -v 4`。`aapt dump badging` 显示 B 包无 `launchable-activity`、A 包有 1 个；从 A 包解出的 `assets/payload.apk` 摘要与 B 包完全相同，`installer_config.json` 的构建 ID、摘要和包名一致。
- 本机数据库在线备份后迁移；前后账号 1、设备 6、快照 5、构建 8、APK 路由 3，`foreign_key_check` 为 0。服务已在 `127.0.0.1:8080` 重启并通过健康检查。未连接真机，因此系统安装确认、安装后打开 B 设置和单张截图仍需真机验收。

## 2026-09-28 A/B 模板分组与详细日志验收

- 模板物理目录已按职责迁移为 `b-packages/screenagent-1.0`、`b-packages/screenagent-1.1`、`a-packages/installer-1.0` 与 `standalone/browser-1.0`；目录清单仍由 `templates.json` 固定登记，不接受网页传入任意源码路径。B 包承载设备侧工作能力，后续截图、无障碍视图等能力均通过新增 B 包版本演进；A 包只负责携带、校验并请求安装选定账号最新成功的 B 包。
- 构建中心的 A/B 面板分别显示模板版本选择；每条完成记录可鉴权下载私有 `build.log`。日志按 `preparing → compiling → signing → aligning → inspecting → publishing` 记录，并包含 Gradle assemble/Lint、`apksigner verify --verbose`、`zipalign -c -P 16 -v 4`、`aapt dump badging`、产物 SHA-256 与失败终止信息。删除构建记录时仍同步删除 APK 目录与构建日志目录。
- 使用真实 Node 单任务队列先完成 B 包 `dcd0990f-7d1f-4e12-8324-78636f0d9a63`，再完成 A 包 `cdd31def-ee27-4a80-804a-287051316854`。B 包 SHA-256 为 `88063b772637215f8ae7dca780654e737b5b73223d73580fc42392793150d027`；A 包内嵌 payload 摘要逐字节相同。B 包没有 `launchable-activity`，A 包有 1 个；两个包的签名和对齐校验均通过。
- 独立脚本也在新目录上真实构建：`npm run build:screenagent` 得到 B 包 SHA-256 `404b74b403b2a33dc36c279d29b1fdb5d5c865820c99ced9bdea02a0805cb697`；`npm run build:apk` 得到浏览器包 SHA-256 `7630135cec45b8a97f91d7c8d3f6508cfc385eb6727675715fa6904d7f95e380`。两个脚本均保存完整 `build.log`、签名输出、badging 和 SHA 清单。
- 最终 `npm run check && npm run test:e2e` 通过：70 项 Node 测试与 14 项 Chromium 测试成功。未连接真机，因此 A 包系统确认安装、打开 B 包设置页、B 包单张截图上传仍作为真机验收项单独报告。
