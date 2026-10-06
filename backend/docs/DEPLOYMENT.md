# Node 本地启动与部署准备

## 当前入口

```bash
npm ci
npm run build
npm start
```

Node >=22.12，地址 [本地工作台](http://127.0.0.1:8080)。使用 `NODE_PORT` 调整端口，开发时 `npm run dev`。无需 PHP / Composer / Docker，也不再运行旧 Worker。Node 同时提供前端、HTTP 与 WS；不要以仓库根目录作为静态站点目录。

目录整理后根 npm ci 分别安装 frontend 与 backend 的锁定依赖，依赖目录留在各自目录；升级时完整保留 backend/.node-private。详见 [目录迁移](DIRECTORY_LAYOUT.md)。

准备脚本创建 SQLite 结构和主密钥但不写入默认账号；首次启动访问 `/install` 设置超管账号和任意非空密码，密码与确认密码可同时切换显示，成功后生成私有 `install.lock` 并锁定安装入口。全新安装没有设备或构建记录。已有账号升级时自动识别为已安装，不重置账号或密码。右上角账号设置可改密，单端会话有效期 8 小时，超管覆盖全部项目设备。

## 私有存储与备份

- `backend/.node-private/boundary.sqlite`：当前唯一业务数据库。
- `backend/.node-private/master.key`：字段加密与 Token 派生密钥，与数据库一起备份，勿公开。
- `backend/.node-private/files/screenshots/`：需登录后经受控路由读取；`backend/.node-private/files/apk-builds/`：只允许通过成功构建的随机 UUID 分享链接下载。两者都不作为静态目录开放，路径仍需校验；不存在的产物明确显示不可用。
- `android/.local-tools/`：Android 工具链、缓存和本地开发签名；`android/dist/`：本地模板构建输出。与后台运行无关，不进 Git。
- 备份数据库应停服务后复制数据库及 WAL，或使用 SQLite 在线备份接口取得一致快照；同步保留主密钥与私有文件。不要只复制运行中的主 `.sqlite` 文件。

旧 PHP 的配置/数据库/运行数据已移出项目留作私有恢复备份；Node 不再读取旧 `storage` 或旧数据库，也没有自动双向同步。

启动自动执行幂等迁移 `005_device_management`，仅为设备表增加 `is_blacklisted` 与 `deleted_at`，不重建或删除历史设备/快照。升级前先按上述方式备份。后台「删除」为软删除：撤销设备接入、隐藏正常读取，历史记录及文件仍保留，也会存在于备份；永久清理与备份保留策略需另行规划。该操作不触及手机文件。

## HTTPS 反向代理部署

服务始终只监听 `127.0.0.1`，默认继续拒绝代理请求。单机 HTTPS 部署需显式设置公开 Origin 和本机可信代理模式：

```bash
NODE_PUBLIC_ORIGIN=https://yk.example.com NODE_TRUST_PROXY=1 npm start
```

反向代理上游使用 `http://127.0.0.1:8080`，必须传递同一公开主机名的 `Host`，并设置 `X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`；`/ws/` 还要启用 HTTP/1.1 Upgrade。受信代理模式兼容同一主机名附带默认 `:80`/`:443` 端口，但仍拒绝其他域名、端口和转发链格式；非代理模式继续精确匹配。不要把 Node 改为监听公网地址，也不要把任意外部代理加入信任链。

### 全新服务器初始化

Git 只保存源码和 npm 锁文件，不保存 `.env`、数据库、主密钥及构建产物。全新克隆后在仓库根目录执行一次：

```bash
./install.sh --origin https://yk1.jk92.cc --port 8081 --trust-proxy
```

脚本依次校验 Node >=22.12、Origin/端口，原子生成权限为 `0600` 的 `backend/.env`，执行 `npm ci`、Vue 构建及数据库结构/主密钥初始化，成功后写入 `backend/.node-private/bootstrap.lock`。准备锁记录版本、时间、Origin、端口、代理模式和 Git SHA，不保存密码或密钥。随后由进程管理器启动服务并访问 `https://域名/install`：第一步通过固定、无用户参数的脚本下载并校验 Temurin JDK 17、Gradle 8.11.1 和 Android 命令行工具，安装 API 35 / Build Tools 35.0.0，逐个预编译 `templates.json` 登记模板并验证离线缓存；进度写入有界的私有 `environment-install.log`，成功写入 `environment.lock`。第二步提交超管表单，通过同源写入校验，在单个事务中创建唯一超管、Argon2id 密码和 APK ID `1`，成功后生成 `backend/.node-private/install.lock`。完成锁只记录账号 ID、用户名、APK ID、时间和来源，不保存密码或摘要。

账号尚未初始化时，环境接口允许部署者完成第一步；账号已经初始化后，只有登录的超管可再次访问环境页面并检测或补齐工具链，不会显示或执行账号初始化。`GET /api/install/environment` 返回各固定组件、阶段和最多 80 行安装日志；`POST /api/install/environment` 启动单个后台安装任务。所有写入仍要求 `X-Boundary-Request: 1` 和同源请求。安装脚本只写入 Git 忽略的 `android/.local-tools/`、`backend/.node-private/environment-warmup/` 与环境日志/锁；完成后删除下载压缩包和预热副本。Linux 服务器至少预留 6 GiB，可用 `npm run install:android-env` 执行同一脚本并查看终端日志。

`bootstrap.lock` 存在时脚本不会覆盖现有配置或私有数据；`install.lock` 与数据库超管共同表示网页安装完成。未登录访问 `/install` 会跳转 `/login`，登录账号可从该地址维护构建环境，但账号初始化表单保持关闭。如果旧版本已有超管但没有完成锁，启动时会补写完成锁，绝不开放二次初始化；单独删除 `install.lock` 不会删除 SQLite 中的账号，进程下次启动也会依据账号补写该锁。准备中断时不会生成准备锁，可以修复后用相同参数重试。普通更新不要删除任何锁或再次初始化。

首次公开启动后立即更换默认密码，并落实进程管理、日志保留、数据库与主密钥一致备份、恢复演练和容量测试。当前支持三级账号与单机租户隔离；多服务器、付款和机器人验证码未接入。专属服务器不要直接共享 SQLite 文件；域名、APK ID 归属与中央数据库规划见 [账号设计](ACCOUNT_DESIGN.md)。

工作室独立服务器采用中央业务 API，而非复制整套超管数据库/主密钥。超管设备汇总、节点身份、域名迁移和断联处理详见 [多服务器设计（未实施）](MULTI_SERVER_DESIGN.md)。当前单机服务不通过填写一个外部域名就自动获得这些能力。

网页 APK 构建和独立 CLI 见 [构建说明](BUILD_BOT.md)；Telegram 接入尚未实现。启动迁移 `006_apk_queue` 为历史构建增加模板/参数/阶段字段，`009_superadmin_apk_id_1` 将默认超管规范 APK ID 设为 `1`，`010_ab_package_builds` 增加 A/B 角色及 A 包锁定的 B 包构建 ID/摘要/包名并把已有 ScreenAgent 构建回填为 B 包；历史记录不覆盖。仅运行一个 Node 服务实例；SQLite 队列串行启动 Gradle，重启后执行中任务失败、排队任务继续。升级前确认无构建执行或接受中断。构建产物、私有日志、签名与容量维护见 [模板指南](../../android/apk-templates/README.md)。

完整截图会话接口仍属 [协议设计阶段](SCREEN_CAPTURE_PROTOCOL.md)。手机首图与网页租约内实时最新帧已按 [ScreenAgent 接入说明](SCREENAGENT_INGRESS.md) 实现设备专用认证和受限 multipart；没有开放监听。主页 URL 与 API origin 分开，手机本机联调可通过用户确认的 USB reverse。临时图片仅放有界内存并只保留最新帧，不进入数据库备份、公共静态目录、代理缓存或请求正文日志；公开入口的 HTTPS/WSS、上传/解码与并发预算需单独部署验收。

## yk1.jk92.cc 更新运行手册

### 固定部署结构

- Git 仓库是单仓库：`backend/` 是 Node API、WebSocket 与静态文件服务，`frontend/` 是 Vue 源码，`android/` 保存 A/B 包模板和工具链。
- Vue 源码不能直接作为生产页面运行。`npm run build` 生成 `frontend/dist/`，随后 `npm start` 启动 Node；Node 直接运行 `backend/src/index.js` 并提供 `frontend/dist/`。
- `frontend/dist/`、各目录的 `node_modules/`、`backend/.node-private/`、`android/.local-tools/` 和 `android/dist/` 均不提交 Git。
- 当前服务器仓库目录为 `/www/wwwroot/yuankon`，宝塔 Node 项目名为 `yuankon`，Node 版本为 `v22.23.3`，应用端口为 `8081`，公开域名为 `https://yk1.jk92.cc`。
- `/www/wwwroot/yk`、`yk.jk92.cc` 及其 `8080` 服务是现有独立项目，更新 `yuankon` 时不得修改。

### “推送部署”触发约定

用户完成本地修改并明确说“推送部署”后，按以下顺序执行。该语句授权本次代码提交、推送和既有 `yuankon` 项目的更新；不代表允许删除服务器数据、覆盖未提交改动或修改其他项目。

1. 在本地仓库检查变更，只提交本次任务相关文件；发现不明改动时停止部署并报告，不执行 `reset` 或删除。
2. 执行 `npm run check` 和 `npm run test:e2e`。测试失败时不提交、不推送、不部署。
3. 提交到当前约定分支并推送 Git，记录提交 SHA。
4. 在服务器部署前记录 `/www/wwwroot/yuankon` 当前 SHA，并确认工作区干净；工作区不干净时停止，不覆盖服务器文件。
5. 使用快进方式拉取、重新安装锁定依赖并构建前端：

```bash
git -C /www/wwwroot/yuankon status --short --branch
git -C /www/wwwroot/yuankon rev-parse HEAD
git -C /www/wwwroot/yuankon pull --ff-only origin main
cd /www/wwwroot/yuankon
PATH=/www/server/nodejs/v22.23.3/bin:$PATH npm ci
PATH=/www/server/nodejs/v22.23.3/bin:$PATH npm run build
```

6. 在宝塔的「网站 → Node项目 → yuankon → 设置 → 服务」中用可视化按钮重启，不用手工 `nohup` 启动第二个实例。
7. 验证宝塔显示“运行中”和 PID，项目日志没有启动错误，服务器 SHA 与推送 SHA 一致，`frontend/dist/index.html` 存在，并实际打开 `https://yk1.jk92.cc/login` 检查页面和接口。出现 `403`、`502` 或旧页面时不得报告部署完成。
8. 普通代码更新不重新绑定 CDN/DNS，不修改宝塔、Nginx 或 Cloudflare 配置；确需变更基础设施时单独说明原因和回滚方式后再处理。

### 数据与回滚边界

- 更新必须保留 `backend/.node-private/`，其中包含 SQLite、主密钥、截图和 APK 构建文件；不得用新目录覆盖，也不得纳入 Git。
- 部署前记录旧提交 SHA。新版本验证失败时先停止继续操作并报告旧、新 SHA；回退代码和重启必须以记录的旧 SHA 为准，不能猜测版本。
- 依赖安装和前端构建不等于数据库备份。涉及迁移时，先确认没有构建任务执行，再按本文件“私有存储与备份”要求备份数据库、WAL、主密钥与私有文件。

### 当前部署状态（2026-09-28）

服务器已安装 Node `v22.23.3`，依赖安装和 Vue 生产构建成功，宝塔中的 `yuankon` 项目已由图形界面启动，域名已经指向该项目。公网登录和管理页沿用同源/代理校验；成功构建的 APK 只通过随机 UUID 产物链接开放直接分享，构建日志及其他管理接口仍需登录。普通更新继续按本运行手册快进拉取并通过宝塔图形界面重启，不用临时修改服务器配置。


## 超管服务器日志（2026-10-05）

更新后启动自动执行增量迁移 `016_server_logs`，只新增 `server_logs` 表及迁移记录；既有账号、设备、协议日志与 Android 模板保持不变。日志从更新后的 Node 启动开始记录，不将旧设备日志转成服务器日志，也不伪造历史运行记录。仍按上面的备份、快进更新、前端构建和进程管理器重启流程部署。

超管登录后直接访问 `/logs`：检查服务初始化/监听记录，触发后台 HTTP 请求后刷新，检查筛选、增量和导出。服务器日志接口与原协议日志接口都显式校验超管角色；普通账号前端角色测试验证入口隐藏和 URL 跳转，普通账号的真实创建/登录和日志接口拒绝已由合成账号测试覆盖。

数据存在私有 SQLite，保留 7 天，每 100 次写入及每小时清理超过 50000 条的旧记录；写入待处理队列最多 1000 项。更新前备份方法不变。回退本次代码时保留新增表和全部私有数据，旧版本只忽略该表，不执行删表或重置。该页面聚合本 Node 服务运行及 HTTP 日志，不读取宝塔、Nginx、操作系统或其他进程的日志文件；现有 stdout/stderr 与构建明细日志继续保留原入口。字段和接口见 [服务器日志](SERVER_LOGS.md)。

## 三级账号与进程接管（2026-10-05）

本次启动自动运行 017_account_hierarchy 增量迁移。projects 先登记现有项目编号，studios 关联新总台，账号新增项目/父级/备注/幂等字段，旧超管与设备编号不重写。备份必须在停服且无构建任务时进行；保留整个私有目录、主密钥、DB/WAL 与既有产物。回退旧代码可忽略新增表/字段，不删表，不覆盖升级后的数据。

宝塔显示未启动但域名正常时，核对 ss -ltnp 8081、ps PID/PPID/用户/命令与 /proc/PID/cwd：独立 nohup 进程可能仍在提供服务。记录原 PID 和启动参数，仅在端口、目录、命令完全匹配 yuankon 后终止该进程；不要全局 pkill node。确认 8081 已释放后，通过宝塔保存并启动 yuankon，生产命令为 env NODE_PORT=8081 NODE_PUBLIC_ORIGIN=https://yk1.jk92.cc NODE_TRUST_PROXY=1 NODE_ENV=production npm --prefix backend start。同时核对宝塔运行状态、管理器 PID、实际监听子进程及公网健康接口；不另起 nohup。

公网验收使用既有超管：确认 /accounts、/logs 和构建环境入口正常。真实总台/子账号由超管自行创建；部署不生成生产测试账号，不重置密码。

## 到期设备接管升级

增量迁移 `018_studio_expiry_takeover` 增加两张接管台账，不重建或清空既有设备/账号表。部署前备份整份 `.node-private`；升级启动即会处理已经到期、未提前续期的总台（含其子账号设备），不要把这一步当只读迁移。接管账号为 APK ID 1 的有效超管；不可用时整笔转移回滚并自动重试。转移包括设备关联历史记录，结束旧租约和缓存；原 APK 路由不全局改写，已接管设备原 APK 重连后取得新平台 JWT，已到期路由的新设备被拒绝。新机 APK/无障碍源码不需要改动；真机重连仍应另行验收。到期后续费不会自动归还已接管设备。
