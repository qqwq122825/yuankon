# Node 本地启动与部署准备

## 当前入口

```bash
npm ci
npm run build
npm start
```

Node >=22.12，地址 [本地工作台](http://127.0.0.1:8080)。使用 `NODE_PORT` 调整端口，开发时 `npm run dev`。无需 PHP / Composer / Docker，也不再运行旧 Worker。Node 同时提供前端、HTTP 与 WS；不要以仓库根目录作为静态站点目录。

目录整理后根 npm ci 分别安装 frontend 与 backend 的锁定依赖，依赖目录留在各自目录；升级时完整保留 backend/.node-private。详见 [目录迁移](DIRECTORY_LAYOUT.md)。

准备脚本创建 SQLite 结构和主密钥但不写入默认账号；首次启动访问 `/install` 设置超管账号和不少于 8 位的密码，成功后生成私有 `install.lock` 并锁定安装入口。全新安装没有设备或构建记录。已有账号升级时自动识别为已安装，不重置账号或密码。右上角账号设置可改密，单端会话有效期 8 小时，超管覆盖全部项目设备。

## 私有存储与备份

- `backend/.node-private/boundary.sqlite`：当前唯一业务数据库。
- `backend/.node-private/master.key`：字段加密与 Token 派生密钥，与数据库一起备份，勿公开。
- `backend/.node-private/files/screenshots/`、`backend/.node-private/files/apk-builds/`：需登录后经受控路由读取的历史文件，路径仍需校验。不存在的产物明确显示不可用。
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

脚本依次校验 Node >=22.12、Origin/端口，原子生成权限为 `0600` 的 `backend/.env`，执行 `npm ci`、Vue 构建及数据库结构/主密钥初始化，成功后写入 `backend/.node-private/bootstrap.lock`。准备锁记录版本、时间、Origin、端口、代理模式和 Git SHA，不保存密码或密钥。随后由进程管理器启动服务并访问 `https://域名/install`；页面提交通过同源写入校验，在单个事务中创建唯一超管、Argon2id 密码和 APK ID `1`，成功后生成 `backend/.node-private/install.lock`。完成锁只记录账号 ID、用户名、APK ID、时间和来源，不保存密码或摘要。

`bootstrap.lock` 存在时脚本不会覆盖现有配置或私有数据；`install.lock` 与数据库超管共同表示网页安装完成，安装完成后 `/install` 自动跳转 `/login`。如果旧版本已有超管但没有完成锁，启动时会补写完成锁，绝不开放二次初始化。准备中断时不会生成准备锁，可以修复后用相同参数重试。普通更新不要删除任何锁或再次初始化。

首次公开启动后立即更换默认密码，并落实进程管理、日志保留、数据库与主密钥一致备份、恢复演练和容量测试。当前仍只有一个超管账号；工作室/成员范围、设备撤销与总台能力未完成。专属服务器不要直接共享 SQLite 文件；域名、APK ID 归属与中央数据库规划见 [账号设计](ACCOUNT_DESIGN.md)。

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

服务器已安装 Node `v22.23.3`，依赖安装和 Vue 生产构建成功，宝塔中的 `yuankon` 项目已由图形界面启动。域名已经指向该项目；公开请求目前仍会被项目自身的同源/代理校验返回 `403`，因此尚不能标记为公网部署验收完成。后续应优先在仓库代码和测试中解决兼容问题，再按本运行手册推送部署；不要用临时修改服务器配置掩盖项目问题。
