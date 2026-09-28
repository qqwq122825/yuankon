# Vue + Node 迁移与 PHP 清理记录 · 2026-09-28

## 当前状态

用户已明确要求删除旧 PHP 后端。项目现在仅使用 Vue 3、Vue Router、Vite、Node、Express、ws、Knex 与 SQLite；同进程提供前端、HTTP 和 WS，无 PHP 代理或 Composer 步骤。

已实现：列表/详情、排序分页、备注、私有图片查看、节点双浮窗、脱敏导出、翻译、状态 WS、协议审计、超管登录与单端会话。具体以 [通信契约](NODE_PROTOCOL.md) 和 [账号设计](ACCOUNT_DESIGN.md) 为准。

截至本轮：新增网页 APK 构建队列、APK ID 首次归属、无障碍首图与网页租约内实时最新帧，见模板指南和 ScreenAgent 接入。尚未实现：Telegram 配对/构建/回传、带暂停/恢复和质量控制的完整诊断会话、工作室/子账号/机器人验证码/设备下发。旧 PHP 对应实现已移除，不再以“仍可运行旧 Worker”描述这些能力。Android 浏览器模板保持原有可见界面与无采集的状态引导功能。

## 已移除

- `app/`、`bootstrap/`、`config/`、`routes/`、Blade 视图、PHP 测试。
- `artisan`、Composer 清单/锁文件、`vendor/`、PHPUnit 配置/缓存。
- PHP 初始化、启动、测试脚本，以及 `frontend/public/index.php`、Apache PHP 入口配置。
- 旧数据库/运行存储目录、旧环境文件（移出项目私有备份）。
- 一次性旧库导入程序 `migrate:legacy` 及其测试；现有迁移数据已在 Node 库中，启动不再依赖导入。
- 旧页面的原生 JS；Vue 仍使用的两份 CSS 移到 `frontend/src/styles/`，由 Vite 打包。
- 合成夹具移到 `backend/fixtures/`，不再保留旧 `resources/` 目录。

## 保留与迁移

- 原有 `backend/.node-private/boundary.sqlite`、`master.key`、超管密码和设备数据保持不变。
- 本机已有 6 台合成示例设备、5 份快照、12 条事件、4 条历史构建记录；不把样例当成真实手机连接。
- 原 `storage/app/private` 的 652 个文件已复制到 `backend/.node-private/files` 并逐一核对 SHA-256；Node 图片和 APK 路由仅从新路径读取。数据库中的相对文件路径不用重写。
- `android/apk-templates/standalone/browser-1.0/` 的模板内容保持一致；`android/.local-tools/`、既有 APK 输入、独立工具与开发签名保留。
- 根目录 `.gitignore` 忽略依赖、私有库/文件、工具链、APK/AAB、签名和生成目录；源码、npm 锁文件、固定模板及许可证保留为版本管理内容。

为保留旧配置、私有数据和未提交文档，清理前建立了**项目外的本机私有恢复目录**。本机路径记录在 `backend/.node-private/cleanup-backup.json`（Git 忽略）；其中也有清理前 Node 数据副本、旧源文件与 Git 差异。该备份不参与服务运行，也不会随仓库上传。不要把备份放回项目静态目录或用旧库覆盖现有 Node 库。

## 启动与测试

```bash
npm ci
npm run build
npm start
# http://127.0.0.1:8080/login，首次账号 mtx / mtx123
npm run check
npm run test:e2e
npm run build:apk
```

全新安装直接创建空 SQLite 与超管；无需旧数据库、旧 `.env`、PHP 或手工导入。当前仍限本机，不是公开部署版本。

清理后验证：

- `npm run check`：格式、编译、36 项 Node 测试通过。移除了 2 项旧库导入测试，新增 2 项 Node 私有图片/APK 路由回归。
- `npm run test:e2e`：8 项 Chromium 测试通过，含登录/挤下旧端、改密、桌面/窄窗口、备注、浮窗、翻译反馈和 WS 重连。
- 空私有目录启动验证通过：自动创建超管并可登录，设备数为 0，无旧环境或数据库依赖。实际 8080 工作区重新验收通过：设备/快照/事件/构建数据与清理前逐行一致，主密钥及 12 个 Android 模板文件校验和一致；3 个历史 APK 下载并核对 SHA-256，4 个已有图片入口成功，页面 JS 错误为 0。
- 核对待版本管理文件：173 个源码/文档/资源文件，PHP 源文件为 0；私有数据、APK、依赖和构建产物均不在候选文件集合中。没有暂存文件或更改提交历史。
- `npm run build:apk`：真实离线 `assembleDebug`、`lintDebug`、apksigner、zipalign 通过。输出 `android/dist/browser-template-d3Q2OE/browser.apk`，SHA-256 `7630135cec45b8a97f91d7c8d3f6508cfc385eb6727675715fa6904d7f95e380`。构建存在既有 SDK XML 版本与弃用 API 提示，未执行 Android 真机运行或 Telegram 发送。
- PHP 测试在上一轮移除前曾通过 67 项；本轮删除后不再作为当前测试命令或依赖。

## Git 状态说明

清理时远端 `main` / HEAD 仍是 `2f8cbfb58d76c729a938603f853cbf6a0cddb577`（旧 PHP 初始提交）。Vue/Node 与此次清理是本地工作区变更，本轮没有创建提交或推送；远端尚未更新。以后提交需同时包含新增的 Vue/Node 文件和旧文件删除，而非仅推送当前旧提交。

不重写 Git 历史；原提交中的 PHP 历史仍可恢复。工作区删除文件不会抹掉已存在的 Git 提交。
