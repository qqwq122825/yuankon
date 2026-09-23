# 本地启动与宝塔部署准备

## 首版状态
当前为免登录本机预览，启动地址默认为 127.0.0.1:8877。服务端拒绝外部来源、外部 Host 与转发请求；APP_ENV=production 时研究页面返回 503。
这是有意设置的上线前置条件。请先完成登录、项目成员校验、审计、独立设备凭证等功能，再进行公开部署。不要将免登录本机服务反向代理到公网。

新增设备 API 默认同样保持本机模式（`DIAGNOSTICS_REMOTE_API=false`）。独立 Sanctum 设备令牌与诊断租约已实现，详见 [DEVICE_API.md](DEVICE_API.md)；APK 上传端尚未接入。显式启用网络 API 时要求 HTTPS，且不会改变管理页的本机限制。调度器需要执行 `diagnostics:prune`（已登记每分钟运行），可在本地运行 `php artisan schedule:work`；接口被访问时也会即时检查过期状态。

## 本地
执行 `bash scripts/setup.sh`，然后 `bash scripts/dev.sh`。脚本不修改全局 PHP 链接，不安装系统级依赖。
本机已有其他项目占用 8765，本项目因此默认使用 8877，未停止其他服务。
默认 SQLite 是为了开箱验证；表结构使用 Laravel Schema，MySQL 配置已在 .env.example 中列出。
SQLite 向 MySQL 切换需要另行迁移已有数据；执行 migrate 只创建表，不自动搬迁旧数据库数据。

## 正式版本准备好认证之后的宝塔方案
1. 使用 PHP 8.3+、匹配扩展、Composer、MySQL；固定 PHP 和依赖版本。
2. Git 拉取源码，执行 Composer install 安装锁定依赖，运行数据库迁移；提前备份数据库。
3. Nginx 网站根目录指向项目 public 目录；其余目录与 .env 保持私有。
4. 配置正式域名与 HTTPS，关闭调试输出；密钥、数据库密码放入服务器独立环境文件。
5. 仅 storage 与 bootstrap/cache 授予应用进程所需写权限；不要全目录 777。
6. 部署后编译缓存并执行健康检查；构建队列与机器人轮询使用进程管理器，更新后重启 Worker 和轮询进程。
7. 密钥、数据库、上传图片、会话和日志独立备份；建立数据保留和删除流程。

无需 Vue 编译、Node 常驻服务或 Docker。Tabler 与原生 JS/CSS 随 Git 版本一起部署。

具体部署脚本在认证阶段完善；当前没有连接服务器、配置宝塔或推送远程仓库。

[Laravel 部署文档](https://laravel.com/docs/13.x/deployment)

## Telegram 构建进程

本地第一版使用 getUpdates 长轮询，只需出站访问 Telegram，不配置公网 Webhook。`yk.jk92.cc` 及 Cloudflare 本轮未修改。主机休眠或进程退出时暂停处理消息；重新启动后根据保存的 offset 继续。

构建工具链、命令与验收步骤见 [BUILD_BOT.md](BUILD_BOT.md)。Linux 部署需安装对应平台的 JDK 17、Gradle 8.11.1、Android SDK API 35 / Build Tools 35.0.0，并通过 BUILD_* 环境项配置路径。不要将 Mac 工具目录直接复制到 Linux。

- 运行一个 `build-bot:poll` 进程，以及一个 `queue:work --queue=apk --timeout=780 --tries=1` 进程。
- `DB_QUEUE_RETRY_AFTER=900`，大于 Worker 超时；更新代码后执行 `queue:restart` 并重启轮询。
- 固定单台构建主机使用文件锁限制轮询实例；多主机部署前先设计统一的分布式租约与任务存储。
- APK、图标、私有构建日志及开发签名密钥不置于 public，不进 Git；APP_KEY 与数据库需一起安全备份。
- Web 后台继续维持本机访问限制；机器人运行不意味着免登录后台可公开。
