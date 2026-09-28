# Node 本地启动与部署准备

## 当前入口

```bash
npm ci
npm run build
npm start
```

Node >=22.12，地址 [本地工作台](http://127.0.0.1:8080)。使用 `NODE_PORT` 调整端口，开发时 `npm run dev`。无需 PHP / Composer / Docker，也不再运行旧 Worker。Node 同时提供前端、HTTP 与 WS；不要以仓库根目录作为静态站点目录。

目录整理后根 npm ci 分别安装 frontend 与 backend 的锁定依赖，依赖目录留在各自目录；升级时完整保留 backend/.node-private。详见 [目录迁移](DIRECTORY_LAYOUT.md)。

首次启动自动创建 SQLite、主密钥和超管 `mtx` / `mtx123`；全新安装没有设备或构建记录。右上角账号设置改密，后续重启保留。单端会话有效期 8 小时，超管覆盖全部项目设备。

## 私有存储与备份

- `backend/.node-private/boundary.sqlite`：当前唯一业务数据库。
- `backend/.node-private/master.key`：字段加密与 Token 派生密钥，与数据库一起备份，勿公开。
- `backend/.node-private/files/screenshots/`、`backend/.node-private/files/apk-builds/`：需登录后经受控路由读取的历史文件，路径仍需校验。不存在的产物明确显示不可用。
- `android/.local-tools/`：Android 工具链、缓存和本地开发签名；`android/dist/`：本地模板构建输出。与后台运行无关，不进 Git。
- 备份数据库应停服务后复制数据库及 WAL，或使用 SQLite 在线备份接口取得一致快照；同步保留主密钥与私有文件。不要只复制运行中的主 `.sqlite` 文件。

旧 PHP 的配置/数据库/运行数据已移出项目留作私有恢复备份；Node 不再读取旧 `storage` 或旧数据库，也没有自动双向同步。

启动自动执行幂等迁移 `005_device_management`，仅为设备表增加 `is_blacklisted` 与 `deleted_at`，不重建或删除历史设备/快照。升级前先按上述方式备份。后台「删除」为软删除：撤销设备接入、隐藏正常读取，历史记录及文件仍保留，也会存在于备份；永久清理与备份保留策略需另行规划。该操作不触及手机文件。

## 公开部署前置工作

本版本仍仅监听 127.0.0.1，严格检查直连、Host、Origin 和转发头。有登录页不代表已完成公开部署，勿直接反向代理出去。

后续需要更换默认密码、补齐工作室/成员范围与设备撤销、HTTPS/WSS、明确代理信任边界、进程管理、日志保留、备份恢复和容量测试。专属服务器不要直接共享 SQLite 文件；域名、APK ID 归属与中央数据库规划见 [账号设计](ACCOUNT_DESIGN.md)。本轮没有向外部服务器部署。

工作室独立服务器采用中央业务 API，而非复制整套超管数据库/主密钥。超管设备汇总、节点身份、域名迁移和断联处理详见 [多服务器设计（未实施）](MULTI_SERVER_DESIGN.md)。当前单机服务不通过填写一个外部域名就自动获得这些能力。

网页 APK 构建和独立 CLI 见 [构建说明](BUILD_BOT.md)；Telegram 接入尚未实现。启动迁移 `006_apk_queue` 为历史构建增加模板/参数/阶段字段，`009_superadmin_apk_id_1` 将默认超管规范 APK ID 设为 `1`，`010_ab_package_builds` 增加 A/B 角色及 A 包锁定的 B 包构建 ID/摘要/包名并把已有 ScreenAgent 构建回填为 B 包；历史记录不覆盖。仅运行一个 Node 服务实例；SQLite 队列串行启动 Gradle，重启后执行中任务失败、排队任务继续。升级前确认无构建执行或接受中断。构建产物、私有日志、签名与容量维护见 [模板指南](../../android/apk-templates/README.md)。

完整截图会话接口仍属 [协议设计阶段](SCREEN_CAPTURE_PROTOCOL.md)。手机首图与网页租约内实时最新帧已按 [ScreenAgent 接入说明](SCREENAGENT_INGRESS.md) 实现设备专用认证和受限 multipart；没有开放监听。主页 URL 与 API origin 分开，手机本机联调可通过用户确认的 USB reverse。临时图片仅放有界内存并只保留最新帧，不进入数据库备份、公共静态目录、代理缓存或请求正文日志；公开入口的 HTTPS/WSS、上传/解码与并发预算需单独部署验收。
