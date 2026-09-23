# Telegram 浏览器 APK 构建

## 第一版范围与验收状态

本版实现「应用名 → 图标 → HTTPS 主页 → 确认 → 构建 → 私聊发送 APK」的流程代码。

- Android 使用原生 Activity + 系统 WebView，仅申请 INTERNET。
- 可见主页/刷新/网址栏；浏览网页不依赖无障碍权限。
- 新增只验证状态的 AccessibilityService 与可跳过的启动引导；未开启时进入系统设置列表，由用户手动选择本应用；已开启则直接浏览。没有短信权限、开机接收器、节点/截图采集、手机自动上线或远程操控。
- 图标只接收 PNG/JPEG（2MB、400 万像素以内），重新编码为 512px PNG。
- 使用开发签名；每次构建产生独立包名，当前不是同一应用的升级发布流程。
- Android SDK 已安装；2026-09-19 真实编译默认图标的引导版 APK 成功（17,664 字节），apksigner 校验通过。Telegram 文件送达尚待账号配对。PHP 自动化测试的虚构 APK 只用于检验发送逻辑，不是实际产物。
- 尚未执行真机或模拟器兼容性测试。出 APK、签名通过、文件送达和应用运行是四个独立验收项。

## 结构与封装

| 部件 | 职责 |
| --- | --- |
| `BuildController` | 本地配置、一次性配对链接、项目归属与下载 |
| `BuildBot` | Token 加密、唯一构建者、会话与轮询 offset |
| `BuildConversation` | 参数校验及有状态的私聊填写流程 |
| `TelegramApi` | 官方 API 请求、附件发送、图标下载和转码 |
| `BuildApk` | 独立 `apk` 队列、任务状态、发送状态 |
| `ApkBuilder` | 复制固定模板、写入资源、Gradle 与签名检查 |
| `android-shell` | 固定 WebView 模板，没有第三方设备控制代码 |

复用 Laravel 队列、HTTP 客户端、字段加密、验证器、存储和 Symfony Process。页面沿用 Blade/Tabler；没有新增 Vue、Node 常驻服务或 Docker 依赖。

## 工具链

固定版本：JDK 17、Gradle 8.11.1、Android Gradle Plugin 8.9.2、API 35、Build Tools 35.0.0；Android 最低 API 26。

当前 Mac 的工具放在 Git 忽略的 `.local-tools`，不修改全局运行时。JDK、Gradle 与 SDK 命令行工具已下载并校验；用户于 2026-09-19 确认接受 Android SDK 许可，随后在本机安装 API 35 和 Build Tools 35.0.0，安装命令退出码为 0，android.jar 与 apksigner 已检查。服务器尚未安装。

默认路径在 `config/build.php`，其他主机可设置：

```dotenv
BUILD_JAVA_HOME=/absolute/path/to/jdk17
BUILD_ANDROID_SDK=/absolute/path/to/android-sdk
BUILD_GRADLE=/absolute/path/to/gradle-8.11.1/bin/gradle
BUILD_GRADLE_HOME=/absolute/path/to/private-gradle-home
QUEUE_CONNECTION=database
DB_QUEUE_RETRY_AFTER=900
```

安装 Android SDK 时选择 `platforms;android-35` 与 `build-tools;35.0.0`。首次 Gradle 构建还会从官方依赖仓库下载依赖；需稳定网络和足够磁盘。源代码中的 compileSdk、AGP 及 Gradle 版本应配套更新，不单独随意升级。

[AGP 官方兼容表](https://developer.android.com/build/releases/agp-8-9-0-release-notes) · [SDK Manager](https://developer.android.com/tools/sdkmanager) · [SDK 许可协议](https://developer.android.com/studio/terms)

## 配置与运行

使用本项目 PHP 8.3+，在项目根目录运行：

```bash
PHP_BIN=/opt/homebrew/opt/php@8.3/bin/php
"$PHP_BIN" artisan migrate
# 终端一：接收 Telegram 消息
"$PHP_BIN" artisan build-bot:poll
# 终端二：构建与发送；工具链就绪后启动
"$PHP_BIN" artisan queue:work --queue=apk --timeout=780 --tries=1
```

1. 打开本地 `/builds`，保存新机器人的 BotFather Token。配置时通过 getMe 验证，保存后不回显。
2. 生成 30 分钟有效的一次性链接，点击后在 Telegram 点「开始」。链接携带配对参数，后台只保存其散列；勿转给他人。
3. 收到「配对成功」后，只接受该 Telegram 私聊账号。其他账号和群消息不进入构建流程。
4. 管理页「前往机器人构建」打开 `?start=build`，也可直接发 `/build`。
5. 按提示输入名称、图标（或 `/default`）、HTTPS 网址，然后 `/confirm`。
6. 构建成功并校验签名后，sendDocument 发送真正的 APK 附件和 SHA-256。

本地开发使用长轮询，不需要 Webhook、公网域名、宝塔或 Cloudflare。轮询和构建进程都需保持运行，电脑休眠期间暂停工作。更新代码后重启这两个长驻进程。

## 指令与恢复

- `/build` 或「开启构建」：新任务。项目已有排队/构建中任务时暂缓新任务。
- `/cancel`：取消当前参数填写；不撤销已经进入队列的任务。
- `/status`：最近构建状态及文件发送状态。
- `/apk`：重新发送最近成功构建的文件，不重复编译。
- `/help`：说明。

构建和文件发送分别记录状态：构建成功不等于 Telegram 送达。断网发送失败后使用 `/apk`；编译失败从本地构建中心查看日志后重新发起。

轮询 offset 在处理消息前持久化以避免重放；极端情况下进程在检查点后退出，该条输入需要重发。任务按 Telegram update ID 去重，构建任务使用原子状态转换防止重复执行。硬杀构建 Worker 可能留下 building 状态，应先检查该进程及队列记录后人工恢复，当前未实现自动孤儿任务回收。

构建超时 600 秒，签名验证 30 秒，附件请求 90 秒，Worker 780 秒，数据库队列重试间隔 900 秒。当前仅单主机单 Worker；这不是几万台设备接入架构。

## 私有数据与产物

- Token：数据库加密字段，依赖本机 APP_KEY；不要记录到异常正文、旧表单输入、Git 或前端脚本。
- 开发签名与 Gradle 缓存：`.local-tools`；正式签名另行设计备份与发布审批。
- APK/编译日志：`storage/app/private/apk-builds/{uuid}`。
- 图标：`storage/app/private/build-icons`。
- 产物下载经过 project_id 检查，免登录页面仍限本机访问。
- 构建主机只运行仓库模板；应用名、图标和网址是数据，不能提交任意 Gradle 脚本或 shell 命令。
- 此版尚未实现产物保留期限和清理策略；正式上线前补齐限额、清理和磁盘告警。

## 实际交付验收清单

- [x] SDK 许可确认并安装平台/构建工具（本机，2026-09-19）。
- [ ] 私聊配对，非配对账号发起任务被忽略。
- [ ] 默认图标及自定义图标分别完成真实构建。
- [x] 默认图标引导版真实编译、apksigner 验证通过；包名、名称、uses-permission 仅 INTERNET、受系统绑定权限保护的服务声明均检查通过。
- [ ] Telegram 聊天出现 APK 附件；发送状态 sent，SHA-256 与本地一致。
- [ ] 在模拟器/真机安装，验证名称/图标/主页/返回键/HTTPS 错误行为。
- [ ] 断网重发、重复确认、失败日志可定位。

当前测试代码使用 HTTP fake 和模拟构建器检验业务流程，真实构建与送达需按以上清单单独记录，不勾选未完成项目。

当前真实产物（百度主页）：`storage/app/private/apk-builds/01a0b876-2d7b-7193-81cd-f81c352e6c2b/browser.apk`，SHA-256 `bd7c52668727253613f6acb89a5dd668d3287a8dbc78bd944b74551cb95d3b00`。模板默认主页为 `https://www.baidu.com`，机器人构建仍可填写其他 HTTPS 主页。构建记录的 `pending` 表示未回传 Telegram，不表示编译仍在进行。引导行为与待实机验收项见 [ANDROID_STARTUP.md](ANDROID_STARTUP.md)。

## 下一阶段设计

包名、双地址配置、客户端可见配对与诊断字段见 [APK_BASE_DESIGN.md](APK_BASE_DESIGN.md)。该文档是待实现设计，不代表当前 APK 已包含通信或上报。
