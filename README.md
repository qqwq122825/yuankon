# Boundary Lab · Vue + Node 设备工作台

Vue 3 + Express / ws + SQLite 本机桌面工作台。根目录统一命令，源码与依赖按职责放入 **三个目录**，不依赖 PHP / Composer / Docker。

## 项目结构

```text
yuankon/
├── frontend/                    # Vue 前端
│   ├── src/                     # 页面、组件、样式
│   ├── public/                  # Tabler、图标、许可证
│   ├── test/                    # Chromium 测试
│   ├── package.json / package-lock.json
│   └── node_modules/、dist/、test-results/  # 自动生成，Git 忽略
├── backend/                     # Node 后端
│   ├── src/                     # API、认证、SQLite、WS、构建队列
│   ├── test/、fixtures/          # 后端测试与合成数据
│   ├── docs/                    # 协议、部署、设计文档
│   ├── package.json / package-lock.json
│   └── .node-private/、node_modules/      # 私有数据与依赖，Git 忽略
├── android/                     # APK 模板与本地工具
│   ├── apk-templates/
│   │   ├── templates.json       # 版本清单，sourceDir 相对此目录
│   │   ├── domains.json         # 后台域名简称映射
│   │   ├── b-packages/          # B 包工作端版本（1.0、1.1）
│   │   ├── a-packages/          # A 包安装器版本
│   │   └── standalone/          # 独立浏览器模板
│   ├── scripts/                 # 本地构建入口
│   ├── installer/               # 既有离线安装器源码
│   ├── apk-repack/、apk-shield/  # 既有独立工具，未接入网页队列
│   ├── inputs/、dist/           # 本地输入与 CLI 产物，Git 忽略
│   └── .local-tools/            # JDK、SDK、Gradle、签名、缓存，Git 忽略
├── package.json / package-lock.json      # 统一 npm 入口，不在根目录安装依赖
├── README_APK.md
└── AGENTS.md
```

`android/legacy-scaffold/` 仅保留原空 Android 目录的旧内容，不参与构建。`.git/` 与少量根配置文件照常保留。

## 安装与启动

需要 Node.js >=22.12，在项目根目录运行：

```bash
npm ci             # 自动分别安装 backend 和 frontend 的锁定依赖
npm run build      # 编译 Vue 到 frontend/dist
npm start          # Node 同域提供页面、API、WS
```

全新服务器首次部署先运行准备脚本；它会校验 Node 版本和参数、安装锁定依赖、构建 Vue、初始化 SQLite 结构与主密钥，并生成 Git 忽略的 `backend/.env` 与 `backend/.node-private/bootstrap.lock`：

```bash
./install.sh --origin https://yk1.jk92.cc --port 8081 --trust-proxy
```

准备完成后启动 Node 并打开 `/install`。安装页第一步在项目私有目录中下载、校验并安装固定的 JDK 17、Android SDK 35、Build Tools 35.0.0、Gradle 8.11.1，并真实预编译登记模板以生成离线缓存；第二步设置初始超管账号和任意非空密码，密码与确认密码可同时切换显示。环境未通过验证时不会开放账号提交，避免安装完成后构建按钮仍为灰色。网页成功创建唯一超管及 APK ID `1` 后生成 `backend/.node-private/install.lock`，账号初始化永久关闭；未登录访问 `/install` 会跳转登录页，登录账号仍可在该页检测或补齐构建环境。`bootstrap.lock` 存在时脚本只报告准备完成，不覆盖配置、数据库或主密钥。后续代码更新使用 `git pull --ff-only`、`npm ci`、`npm run build` 和进程管理器重启，不再次运行初始化脚本。也可通过 `npm run init:server -- --origin ...` 调用。

新安装打开 [安装页](http://127.0.0.1:8080/install)，已有安装打开 [登录页](http://127.0.0.1:8080/login)。右上角账号设置支持退出与改密；升级不会重置原有账号、密码、设备、截图和构建记录。

- `npm run dev`：Node + Vite 热更新，仍是同域 8080，不需分别启动两个端口。
- `npm run install:android-env`：在 Linux 服务器直接执行与安装页相同的固定 Android 环境安装脚本。
- `NODE_PORT=8082 npm start`：改本机端口。
- `npm start` 会自动读取存在的 `backend/.env`，Shell 或进程管理器中已经设置的环境变量优先。
- 单独安装：`npm ci --prefix backend`、`npm ci --prefix frontend`。
- 根目录使用 `--ignore-scripts` 时会跳过两边自动安装，需另执行上面两条命令。
- 启动路径不依赖当前工作目录；`cd backend && npm start` 同样读取 backend/.node-private。
- 当前仅监听 127.0.0.1，保留 Host / Origin / 转发头检查，不是直接公开部署版本。

## 构建中心与模板

[构建中心](http://127.0.0.1:8080/builds) 分为两个板块：先构建 B 包工作端，再构建有桌面入口的 A 包安装器。A 包自动锁定同一归属账号最新成功 B 包并将其作为 `assets/payload.apk` 携带；Android 系统安装器仍要求用户确认。A 包 1.1 首次启动未检测到 B 包时只显示安装入口；安装成功返回后显示无障碍说明和「打开无障碍」按钮，用户点击后进入 Android 系统无障碍页面，开启 B 包服务并返回后进入构建时配置的 HTTPS 内置浏览器首页。完成首次引导后，只要检测到 B 包已安装就直接进入首页。当前 B 包 1.7 保留一个仅用于系统屏幕共享确认与停止的可见入口；无障碍服务负责自动上线与心跳，用户确认 MediaProjection 后才获取并上报画面。真实编译、Lint、签名/对齐验证后开放下载与可直接分享的随机构建 ID 链接；构建日志及其他管理接口仍要求登录。

**模板源码统一放在 `android/apk-templates/`。** `b-packages/` 保存截图、设备通信及后续无障碍视图等工作端版本；`a-packages/` 只保存安装器版本；`standalone/` 保存不参与 A/B 依赖的模板。新增版本复制对应分组内的版本目录、修改源码并登记 `templates.json`，刷新页面即可选择。A/B 构建记录显示阶段进度条；点击「构建日志」直接在记录下方展开并自动刷新 Gradle/Lint、签名、对齐、包信息和摘要步骤，不再触发浏览器下载。详见 [APK 开发入口](README_APK.md) 和 [新增模板指南](android/apk-templates/README.md)。

```bash
npm run build:apk          # 独立构建 browser-1.0
npm run build:screenagent  # 独立构建当前 screenagent-1.7 MediaProjection 版
```

CLI 产物在 `android/dist/`；网页构建产物在 `backend/.node-private/files/apk-builds/`。模板源码、临时源码与产物分开维护，不在 dist 中长期改功能。

## 当前能力

- 超管全项目设备访问、Token 鉴权、8 小时单端会话、退出与改密。
- 顶栏账号卡显示角色、创建账号时自动分配的固定 APK ID 和账号有效期；一个账号一个编号，初始超管编号为 `1`。构建填写有效编号归属对应账号，留空或未匹配可用账号时归属默认接收账号（当前为超管）；构建不创建新编号。超管默认长期有效；账号截止时间与登录 Token 到期分开，服务端校验有效期。总台续费流程见 [账号设计](backend/docs/ACCOUNT_DESIGN.md)。
- 设备列表/详情、筛选排序分页、单值备注与多条标签备忘、不可变首次登记时间、截图/节点双浮窗、元数据观察、脱敏导出、翻译配置。
- 整行进入详情；操作仅拉黑/删除，删除为后台软删除，不清除手机数据。
- 设备首次登记、APK ID 默认归属、独立设备凭证、状态 WS、无障碍开启首图、网页租约内实时最新帧 JPEG、固定快捷操作与列表临时缩略图。
- 网页 APK 队列、实际产物下载、固定模板独立 CLI 编译。
- **待实现**：总台/子账号、机器人验证码、Telegram 构建/发送。没有总台 AppID。
- 浏览器模板不增加采集能力；当前 ScreenAgent 1.7 由用户在系统对话框确认屏幕共享；有效网页查看租约内使用 ImageReader 读取最新帧，并在上一帧上传完成后串行申请下一帧，不使用固定 1 秒定时器。编译通过与真机通过分别验收。

## 测试与版本管理

```bash
npm run check
npm exec --prefix frontend -- playwright install chromium  # 首次缺浏览器时
npm run test:e2e
```

测试使用临时库，不覆盖真实工作区密码与数据。桌面最小画布 1280px，窄窗口横向滚动。

源码、三份 npm 清单/锁文件、固定模板和文档进 Git；数据库、密钥、依赖、构建输出、APK、工具链、截图和本地备份均忽略。

2026-09-28 已完成真实浏览器验收：登录 → 填写 ScreenAgent 1.0 参数 → 随机包名 → 提交构建 → 复制链接 → 下载 APK；下载文件的签名、对齐和 SHA-256 校验通过。当前 `npm run check` 的 76 项 Node 测试和 `npm run test:e2e` 的 15 项 Chromium 测试通过，覆盖一次性网页安装。详细结果见 [浏览器构建验收](backend/docs/BUILD_ACCEPTANCE.md)；真机安装与截图发送另行验收。

说明：[目录迁移记录](backend/docs/DIRECTORY_LAYOUT.md) · [HTTP / WS](backend/docs/NODE_PROTOCOL.md) · [设备接入](backend/docs/SCREENAGENT_INGRESS.md) · [账号归属](backend/docs/ACCOUNT_DESIGN.md) · [部署备份](backend/docs/DEPLOYMENT.md) · [UI](backend/docs/UI_DESIGN.md)。

### B 包 1.7.8：横屏截图与运行操作
- 截图窗口保持 viewer-width（默认 300px），每帧更新宽高比；横屏缩为宽 300px 的横向画面，无图时保持最近比例。
- 手机桌面模式页点击「运行操作」并确认，开启两分钟单击；屏幕顶部持续显示可点击的停止入口。默认关闭，授权不持久化，网页租约结束、断线或切模式即结束。
- 网页图片加载后显示十字光标，单击映射到实际图片区域；使用当前查看租约、近期 frameId 和归一化坐标。手机校验帧对应的真实屏幕尺寸、旋转、租约与本机授权，只执行 50ms 单点，完成后回执。无长按、拖动。
- 节点正文与输入内容按项目约定剔除。旧截图授权不自动开启手机单击。
- `npm run build:screenagent` 默认构建 1.7.8（versionCode 16）；1.7.6 等旧模板保留不变。构建、网页合成设备测试与真机测试分别记录。

#### 1.7.8 直传优化
实时截图不再逐帧申请 uploadId，两种模式在有效查看心跳内携带已有 commandId/viewerId 直接上传。设备身份鉴权保留，不增加独立网络往返；心跳失效、断线、关闭查看即停止。网页使用WS元数据和有界最新帧队列，JPEG去除重复编码开销（仍校验）；旧版本首图许可接口兼容。详见 `backend/docs/SCREEN_CAPTURE_PROTOCOL.md`。

### 1.7.8 阅读器文字修正（2026-10-03）
恢复实时节点实际 text/content_description（每字段最多2000字符，仅当前查看租约的临时内存）；密码、敏感和 editable 输入字段仍剔除。无文字的节点不再用 Button/TextView/FrameLayout 类名占位，布局结构和坐标保留。需要重新构建安装修正版1.7.8 B包，已有APK不会自动更新。

1.7.8 运行操作已移除固定两分钟超时：本机确认后在当前查看会话持续有效，状态只保存在内存；顶部停止横幅、停止按钮、查看租约失效、断线、模式切换和服务重启的停止机制不变。不会在重连或重启后自动授权。

### 服务器节点文字透传（2026-10-03）
按用户要求取消服务器基于password/sensitive/editable标记的文字置空：实时text和content_description按客户端上传值返回（text_policy=uploaded），网页以文本节点显示，不解析HTML。保留类型/2000字符长度/结构校验、设备鉴权、账号归属、查看租约和有界内存。Android端原有密码与可编辑输入过滤不变，服务器不补造客户端未上报的文字。


### B 包 1.7.9：桌面节点刷新诊断（versionCode 17）

独立复制 1.7.8 模板，旧版本保留。默认构建切换至 1.7.9。继承查看租约内每秒补采、focused/active 应用窗口根节点刷新与真实屏幕尺寸；新增 flagIncludeNotImportantViews、图标点击事件补采和 Android 13+ clearCache 清理旧子节点缓存。API 调试仅记录包名、根节点状态、节点数量、截断与缓存能力，不记录节点正文。

已知桌面问题的候选原因：上一版本仅事件驱动且根节点缓存可能滞后；服务未请求非重要视图；启动器本身也可能不暴露部分图标。此修订不使用 OCR、不会伪造缺失节点，不能凭编译证明所有启动器都已恢复。

测试安装后主动开启查看与 API 调试，依次检查 B 包 → Home → 打开/关闭文件夹 → 设置 → Home。核对 service/nodes_snapshot 包名切换、rootStatus、nodeCount 和截断状态。无真实设备连接时只报告编译/合成测试，不宣称桌面真机修复。密码/可编辑输入字段仍置空；本机运行操作授权、可见停止与会话失效停止不变。
