# Boundary Lab · 无障碍研究后台

PHP/Laravel + Blade + Tabler 的本地只读研究工作台。无需 Vue、npm 构建或 Docker。

## 已实现
- 设备列表：紧凑顶栏、窄图标导航、铺满宽度的数据表；搜索、筛选、表头升降序排序、分页、选择、详情跳转与备注持久化。
- 主侧栏精简为「设备、构建、翻译」三个入口，其他主菜单隐藏，既有记录保留。
- 列表顶栏按参考结构展示在线/设备总数、今日/昨日指标；API 设备按心跳判断在线，尚无 API 设备或尚未接入的每日事件显示「—」，不以快照数量冒充实时指标。
- 设备详情：左菜单、中央圆形入口、右工具栏；截图与节点双浮窗，可拖动、关闭、重置位置；节点折叠/搜索/属性检查/坐标映射/JSON 查看。
- 两个浮窗默认各 300px，可独立缩放到 220–500px；阅读器 A−/A＋调字号，支持固定样例标签的原文/翻译切换。
- 翻译设置：Google Cloud Translation Basic v2；密钥加密保存、手动验证、按需调用与 10 分钟缓存。未填写真实 Key 时不展示假验证结果。
- 快照档案、观察记录、脱敏 JSON 下载。
- 已移除手动导入页面、按钮及上传路由；保留既有记录、私有截图查看和内部数据校验测试。
- 密码字段、短信界面/通知/权限场景的**元数据观察**，仅接受声明为合成测试数据的记录。
- 免登录本机模式、服务端输入校验、项目归属检查、自动化测试。
- Telegram 构建中心、单账号一次性配对、应用名/图标/HTTPS 主页会话、队列构建、签名校验、APK 文件回传及重发代码。
- Android 启动引导：本应用服务未开启时弹窗，按钮进入系统无障碍设置；可选「仅浏览网页」。已开启则进入主页，返回设置后重新检查，不自动采集。
- 浏览器模板默认主页为 `https://www.baidu.com`；Telegram 构建仍使用用户在主页步骤填写的 HTTPS 地址覆盖模板值。
- 服务端联调接口：Sanctum 独立设备凭证、心跳、用户发起的会话、10 秒网页租约、临时截图/结构帧接收；APK 上传端待实现。详见 [接口协议](docs/DEVICE_API.md)。
- `AGENTS.md`：后续 AI 开发规范与范围。

## 当前边界
这不是已连接手机的远程服务。预置设备、事件和界面图均为明确标注的合成示例。
已有真实开发签名 APK：浏览器与无障碍开关引导版，2026-09-19 编译和签名验证通过。构建中心可下载；Telegram 文件送达仍待私聊配对验收。
APK 的无障碍服务目前只用于启动/开关状态验证，没有节点、截图、短信或后台上传。手机上线、登录/子账号仍待实现。没有真机或模拟器运行验证；[启动流程与验收清单](docs/ANDROID_STARTUP.md)记录实际完成项。
当前固定项目隔离不等同于完整多租户权限系统。

## 表头排序
点击 ID、设备名称、备注、来源、品牌、Android、快照、电量、无障碍、节点、窗口、最近入库表头即可排序；再次点击切换升降序。
- 默认 ID 升序；箭头与 `aria-sort` 标识实际方向。
- 数据库先对全部匹配记录排序再分页，并以内部 ID 打破并列，避免翻页重复跳动。
- 搜索、筛选和分页保留排序；切换排序回到第一页，清除筛选仍保留当前排序。
- 电量和计数按数字排序，Android 版本按数值处理；未知值末尾显示。节点/窗口采用最新快照而非历史最大值。
- 预览、数据状态（与来源重复）及操作列不放无效排序箭头。

## 本地运行
需要 PHP 8.3+、Composer 2；启用 `pdo_sqlite`、`fileinfo`、`gd`、`mbstring`、`xml`、`curl`、`zip` 等 Laravel 所需扩展。

```bash
bash scripts/setup.sh
bash scripts/dev.sh
```

浏览器打开 [本地工作台](http://127.0.0.1:8877)。默认只监听 127.0.0.1。
如果电脑默认 PHP 较旧，脚本会优先使用已有的 Homebrew PHP 8.3，不修改全局 PHP 链接；其他环境通过 `PHP_BIN=/绝对路径/php` 指定运行时。
端口冲突时使用 `PORT=8878 bash scripts/dev.sh`，并相应调整本地 APP_URL。

初始化会生成本地密钥、创建 SQLite 数据库、执行迁移并加入六台示例设备。重复执行不会清空数据或覆盖备注。

已有安装更新本轮功能时，使用 PHP 8.3+ 执行 `composer install` 和 `php artisan migrate`，新增翻译、构建、设备令牌和诊断会话表；保留原有 `.env` 的 `APP_KEY` 以读取加密配置。具体见 [翻译接入](docs/TRANSLATION.md)和[设备接口](docs/DEVICE_API.md)。

## Telegram APK 构建

打开 [构建中心](http://127.0.0.1:8877/builds)，连接机器人、生成一次性链接并完成私聊配对。随后在 Telegram 按顺序填写应用名、图标和 HTTPS 主页，确认后排队。

工具链安装、进程命令、开发签名与交付验收见 [构建机器人说明](docs/BUILD_BOT.md)。PHP 页面本身仍不需要 Node 或 Docker；APK 构建进程另需 JDK、Gradle 和 Android SDK。

## 验证
```bash
bash scripts/test.sh
PHP_BIN=/opt/homebrew/opt/php@8.3/bin/php
"$PHP_BIN" vendor/bin/pint --test
"$PHP_BIN" artisan view:cache
```

除本机路径选择外，项目可使用普通 `php artisan ...` 命令。服务器运行时版本必须与锁文件兼容。

## 目录与职责
- `app/Http/Controllers/LabController.php`：页面与只读导出入口。
- `app/Services/SnapshotNormalizer.php`：结构校验、深度限制、字段白名单。
- `app/Services/ObservationNormalizer.php`：密码/短信合成场景元数据规则。
- `app/Services/SnapshotImporter.php`：内部样例测试工具；无网页上传入口，保留事务、字段白名单及失败清理。
- `app/Support/DeviceTableSort.php`：服务端排序字段白名单、数值处理、空值置后与稳定分页。
- `app/Services/ScreenshotStore.php`：图片校验、重新编码、私有存储。
- `app/Http/Middleware/LocalResearchOnly.php`：免登录本机访问边界。
- `resources/views/components/`：可复用 Blade 组件。
- `public/vendor/`：固定版本预编译 Tabler 与图标；保留许可证。
- `resources/fixtures/`：虚构界面和协议样例。

布局按参考图的结构和密度实现，仅面向桌面，最小画布宽 1280px；窄窗口横向滚动，保留左右侧栏与并排浮窗。研究功能使用本项目真实字段，预览缩略图为合成占位。

说明：[UI 约定](docs/UI_DESIGN.md) · [协议](docs/SNAPSHOT_PROTOCOL.md) · [研究范围](docs/RESEARCH_SCOPE.md) · [宝塔部署准备](docs/DEPLOYMENT.md) · [第三方组件](docs/THIRD_PARTY.md)。

## 后续顺序
1. 完成真机采集端与协议联调，验证不同系统版本下的实测差异。
2. 增加登录、项目成员权限、设备配对与凭证撤销，再开放网络接入。
3. 完成 APK 真机构建/运行验收；以后按实测负载扩容构建队列和隔离构建主机。

仓库没有提交或推送到远端，也没有向服务器部署。
