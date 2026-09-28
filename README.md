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

打开 [登录页](http://127.0.0.1:8080/login)。首次初始化超管 `mtx` / `mtx123`；右上角账号设置支持退出与改密。原有密码、设备、截图和构建记录保留。

- `npm run dev`：Node + Vite 热更新，仍是同域 8080，不需分别启动两个端口。
- `NODE_PORT=8082 npm start`：改本机端口。
- 单独安装：`npm ci --prefix backend`、`npm ci --prefix frontend`。
- 根目录使用 `--ignore-scripts` 时会跳过两边自动安装，需另执行上面两条命令。
- 启动路径不依赖当前工作目录；`cd backend && npm start` 同样读取 backend/.node-private。
- 当前仅监听 127.0.0.1，保留 Host / Origin / 转发头检查，不是直接公开部署版本。

## 构建中心与模板

[构建中心](http://127.0.0.1:8080/builds) 分为两个板块：先构建无桌面图标的 B 包工作端，再构建有桌面入口的 A 包安装器。A 包自动锁定同一归属账号最新成功 B 包并将其作为 `assets/payload.apk` 携带；Android 系统安装器仍要求用户确认。真实编译、Lint、签名/对齐验证后开放下载与复制登录后可用的链接。

**模板源码统一放在 `android/apk-templates/`。** `b-packages/` 保存截图、设备通信及后续无障碍视图等工作端版本；`a-packages/` 只保存安装器版本；`standalone/` 保存不参与 A/B 依赖的模板。新增版本复制对应分组内的版本目录、修改源码并登记 `templates.json`，刷新页面即可选择。A/B 构建记录均可下载含 Gradle/Lint、签名、对齐、包信息和摘要步骤的详细日志。详见 [APK 开发入口](README_APK.md) 和 [新增模板指南](android/apk-templates/README.md)。

```bash
npm run build:apk          # 独立构建 browser-1.0
npm run build:screenagent  # 独立构建当前 screenagent-1.2
```

CLI 产物在 `android/dist/`；网页构建产物在 `backend/.node-private/files/apk-builds/`。模板源码、临时源码与产物分开维护，不在 dist 中长期改功能。

## 当前能力

- 超管全项目设备访问、Token 鉴权、8 小时单端会话、退出与改密。
- 顶栏账号卡显示角色、创建账号时自动分配的固定 APK ID 和账号有效期；一个账号一个编号，当前默认超管编号为 `1`。构建填写有效编号归属对应账号，留空或未匹配可用账号时归属默认接收账号（当前为超管）；构建不创建新编号。超管默认长期有效；账号截止时间与登录 Token 到期分开，服务端校验有效期。总台续费流程见 [账号设计](backend/docs/ACCOUNT_DESIGN.md)。
- 设备列表/详情、筛选排序分页、备注、截图/节点双浮窗、元数据观察、脱敏导出、翻译配置。
- 整行进入详情；操作仅拉黑/删除，删除为后台软删除，不清除手机数据。
- 设备首次登记、APK ID 默认归属、独立设备凭证、状态 WS、无障碍开启首图、网页租约内实时最新帧 JPEG 与列表临时缩略图。
- 网页 APK 队列、实际产物下载、固定模板独立 CLI 编译。
- **待实现**：总台/子账号、机器人验证码、Telegram 构建/发送、连续截图会话。没有总台 AppID。
- 浏览器模板不增加采集能力；ScreenAgent 只在明确网页查看租约有效时运行最新帧循环，Android 11 间隔 1001ms、Android 12+ 间隔 334ms，并串行完成截图、压缩和上传。编译通过与真机通过分别验收。

## 测试与版本管理

```bash
npm run check
npm exec --prefix frontend -- playwright install chromium  # 首次缺浏览器时
npm run test:e2e
```

测试使用临时库，不覆盖真实工作区密码与数据。桌面最小画布 1280px，窄窗口横向滚动。

源码、三份 npm 清单/锁文件、固定模板和文档进 Git；数据库、密钥、依赖、构建输出、APK、工具链、截图和本地备份均忽略。

2026-09-28 已完成真实浏览器验收：登录 → 填写 ScreenAgent 1.0 参数 → 随机包名 → 提交构建 → 复制链接 → 下载 APK；下载文件的签名、对齐和 SHA-256 校验通过。`npm run check` 的 58 项 Node 测试和 `npm run test:e2e` 的 11 项 Chromium 测试通过。详细结果见 [浏览器构建验收](backend/docs/BUILD_ACCEPTANCE.md)；真机安装与截图发送另行验收。

说明：[目录迁移记录](backend/docs/DIRECTORY_LAYOUT.md) · [HTTP / WS](backend/docs/NODE_PROTOCOL.md) · [设备接入](backend/docs/SCREENAGENT_INGRESS.md) · [账号归属](backend/docs/ACCOUNT_DESIGN.md) · [部署备份](backend/docs/DEPLOYMENT.md) · [UI](backend/docs/UI_DESIGN.md)。
