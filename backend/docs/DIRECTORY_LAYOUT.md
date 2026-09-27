# 三目录整理记录 · 2026-09-28

## 结构与职责

根目录只有三个工作目录：`frontend/`、`backend/`、`android/`，另保留 `.git/`、统一 npm 入口和少量说明/配置文件。

| 原位置 | 当前位置 |
|---|---|
| `frontend/` | `frontend/`，新增独立清单/锁文件/依赖 |
| 根目录 `public/` | `frontend/public/` |
| 根目录 `playwright.config.js`、`test-results/` | `frontend/` 下对应位置 |
| `server/` | `backend/`，新增独立清单/锁文件/依赖 |
| 根目录 `docs/`、`.node-private/` | `backend/` 下对应位置 |
| `apk-templates/` | `android/apk-templates/` |
| `android-screenagent/` | `android/apk-templates/screenagent-1.0/` |
| `android-shell/` | `android/apk-templates/browser-1.0/` |
| `android-installer/` | `android/installer/` |
| `apk-repack/`、`apk-shield/` | `android/` 下对应位置，仍保持同级关系 |
| `scripts/`、`.local-tools/`、`dist/` | `android/` 下对应位置 |
| 根目录 `safe.apk`、`5412ce7f.apk` | `android/inputs/` |
| 原 `android/app/` 空目录内容 | `android/legacy-scaffold/app/`，不参与构建 |

原工具源码与行为保留，仅构建脚本和路径引用适配新位置，没有把加壳等独立功能并入网页队列。

## 依赖与命令

根 package.json 仅调度命令，postinstall 依次执行 `npm ci --prefix backend` 和 `npm ci --prefix frontend`。两边各有锁文件，依赖在各自的 node_modules，根目录不做工作区依赖提升。不使用跨目录 node_modules 软链；已执行完整离线 npm ci 验证。

`npm start/dev/build/check/test:e2e/build:apk/build:screenagent` 保持根入口；后端单独 `cd backend && npm start` 也可使用。Express 仍同域托管前端、API 和 WS；开发模式从 frontend 加载 Vite 配置，没有拆成两套服务。

服务配置基于文件位置解析项目根，而非 shell 当前目录。私有 SQLite 路径为 backend/.node-private/boundary.sqlite；静态资源来自 frontend/public，编译页面来自 frontend/dist。Android 工具链解析到 android/.local-tools。

## 模板约定

模板版本与源码目录统一在 android/apk-templates。清单中 sourceDir **相对该目录**，例如 `screenagent-1.0`，不再相对项目根。读取时同时校验路径与真实路径，阻止跨目录或符号链接越界。

新增 1.1 复制一个版本目录，再追加 templates.json 条目；刷新页面即可选择。新版本命名、Gradle 属性、资源注入与输出格式见 [模板指南](../../android/apk-templates/README.md)。历史构建的模板快照保留原记录，不重写已成功任务，也不更改已有产物 URL。

## 数据保留与验证

- 移动前确认没有 queued/building 任务并停止本机服务，使用 SQLite 在线备份接口保存一致快照。
- 备份及移动清单位于 backend/.node-private/backups；移动前后逐表 JSON 摘要一致：6 台设备、5 条快照、12 条事件、6 条构建、1 个账号、2 条 APK 归属。主密钥摘要相同，外键检查无错误。
- Android 模板、安装器及原输入共 828 个文件在移动前后逐文件 SHA-256 一致。代码目录移动不改手机行为，不安装或清空设备。
- `npm ci --offline`、`npm run check`（58 项 Node 测试）、`npm run test:e2e`（11 项 Chromium 测试）通过。新增目录/锁文件/模板根约束回归测试。
- 生产 8080 健康检查和 Tabler 静态资源通过；临时库上的 Express + Vite 开发浏览器登录/构建页通过，页面错误为 0。
- 真实 CLI 构建两种模板，assembleDebug/lintDebug/apksigner/zipalign 均通过，产物摘要与整理前默认模板产物相同：
  - `android/dist/browser-template-RLaR8o/browser.apk`：`7630135cec45b8a97f91d7c8d3f6508cfc385eb6727675715fa6904d7f95e380`。
  - `android/dist/screenagent-9Kxbgo/screenagent.apk`：`13cc046a9590ca8f874b7c1026bc54f493295f8dbbaf6e8463920864b8e2f2f4`。
- 目录整理阶段未做加壳/改包功能变更或真机安装；后续用户要求的真实浏览器构建验收见 [BUILD_ACCEPTANCE.md](BUILD_ACCEPTANCE.md)。

## 迁移到其他机器

从仓库取源码后在根执行 npm ci；Android 工具链、签名和离线缓存另行准备至 android/.local-tools（或通过环境变量指定），数据库/主密钥/私有文件通过私有备份恢复至 backend/.node-private。不要将旧根目录 .node-private 再启动为空库，也不要上传工具链或私有数据到 Git。
