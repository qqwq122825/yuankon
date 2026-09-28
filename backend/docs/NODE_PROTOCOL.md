# Node 通信契约 · boundary-node-v1

## 与输入说明的关系

参考 2026-09-27《无障碍辅助设备管理平台 · 通信协议规范 开放版 v1.0》。当前采用其面板通道、推荐消息信封、公开设备 ID、状态上报双层 type 和事件命名；不是全协议替代实现。HTTP 端点是否存在以本文件和代码为准，未实现接口返回 404，未知 WS 报文返回 `error`。

当前进程仅监听 `127.0.0.1:8080`，所有 HTTP/WS 校验直连本机地址、Host、Origin 和转发头。全新数据库仅开放安装状态、固定构建环境安装与受限的单次账号安装接口；部署者在 `/install` 先安装并验证 Android 构建环境，再设置超管账号和密码。成功后账号安装永久关闭；构建环境接口改为仅登录账号可访问，便于后续检测或补齐工具链，其他 API 同时开放。登录后可跨所有项目查看设备。设备上报的项目归属仍由服务端凭证与数据库确定。

安装完成后，除健康检查、登录、随机 UUID 构建产物下载与下述设备专用接口外，业务 HTTP API 要求账号 JWT，支持 `Authorization: Bearer ACCOUNT_TOKEN` 或 HttpOnly Cookie。构建产物链接用于直接分享，仅开放成功任务的 APK 文件；日志、列表、删除及其他管理接口仍需登录。账号 JWT 与设备 JWT、面板 WS 票据互不通用。账号仅保留一个有效会话，JWT 签名有效还需通过 SQLite 当前会话/角色/启用状态校验。详见 [账号方案](ACCOUNT_DESIGN.md)。

## HTTP

新增的 APK 归属、自动上线、实时最新帧专用 HTTP 接口详见 [ScreenAgent 接入](SCREENAGENT_INGRESS.md) 与已实现的 [boundary-screenshot-v2](SCREENSHOT_COMMAND_PROTOCOL.md)。当前 B 包在无障碍服务连接时调用 `/api/client/online`，服务器按 APK ID 幂等归属并静默返回内部设备 Token；旧 `/api/client/register` 和登记码仅兼容旧包。`/api/sync/status`、`/api/device/screenshot-session`、`/api/device/screenshot` 使用设备 Bearer Token，最后一个端点为受限 multipart，其余写入仍是 JSON。所有写入继续要求 `X-Boundary-Request: 1`。

| 方法           | 路由                                        | 行为                                                                                                              |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET            | /api/install/status                         | `{installed:boolean}`；不返回账号或锁内容                                                                         |
| GET            | /api/install/environment                    | 未初始化时直接开放；初始化后需账号登录。返回固定组件、安装阶段、有界日志与 ready 状态                             |
| POST           | /api/install/environment                    | 未初始化时直接开放；初始化后需账号登录。启动单个固定 Linux 环境安装任务；无用户参数，202 表示正在执行             |
| POST           | /api/install                                | 仅环境验证通过且未安装时接受 `{username,password,confirmPassword}`；事务创建唯一超管与 APK ID `1`，成功后永久关闭 |
| POST           | /api/client/online                          | B 包自动上线；`{deviceId,apkId,设备画像}` → 按 APK ID 归属、幂等设备记录与内部设备 Token                          |
| GET            | /api/health                                 | Node/Vue/协议/本机模式状态                                                                                        |
| POST           | /api/auth/login                             | `{username,password}` → `{token,expiresIn,user}`；8 小时账号 JWT，同时设置 HttpOnly Cookie                        |
| GET            | /api/auth/me                                | 当前账号公开信息；需登录                                                                                          |
| POST           | /api/auth/logout                            | 撤销会话、清 Cookie、断开面板 WS；JSON `{}`                                                                       |
| POST           | /api/auth/change-password                   | `{oldPassword,newPassword}`；新密码 6–128 字符，成功撤销会话                                                      |
| GET            | /api/session                                | 需登录；10 分钟专用面板 JWT，绑定当前账号会话；只在内存持有                                                       |
| GET            | /api/system/info                            | 真实能力与待迁移项                                                                                                |
| GET            | /api/devices、/api/device/list              | `{data,total,page,perPage,filters,stats}`；有效单帧附 `thumbnail`                                                 |
| GET            | /api/devices/:id?snapshot=                  | 数值数据库 ID；设备、快照、固定样例标签及事件元数据                                                               |
| GET            | /api/devices/:id/accessibility-snapshot     | `viewerId=UUID`；只返回当前有效租约的内存脱敏节点快照，正文策略固定为 omitted                                      |
| PATCH          | /api/devices/:id/note                       | `{note}`，200 字符上限                                                                                            |
| GET/POST       | /api/devices/:id/memos                      | 列出备忘 / 新增 `{body,label}`；正文 1–500 字符，标签为 `none                                                     | important | follow_up | handled` |
| PATCH/DELETE   | /api/devices/:id/memos/:memoId              | 修改 `{body,label}` / 删除 `{}`；同时校验设备、项目与备忘关联                                                     |
| PATCH          | /api/devices/:id/blacklist                  | `{blacklisted:boolean}` → `{device}`；拉黑或取消拉黑，当前超管访问                                                |
| DELETE         | /api/devices/:id                            | JSON `{}` → `{ok:true,mode:'soft-delete'}`；后台软删除，重复删除幂等                                              |
| GET            | /api/snapshots、/api/events                 | 每页 20 条                                                                                                        |
| GET            | /api/snapshots/:id/export                   | 再次白名单脱敏后的 JSON                                                                                           |
| GET            | /api/snapshots/:id/image                    | 登录、设备/快照关联、路径检查、PNG 解码；合成样例走固定 SVG                                                       |
| GET            | /api/build-templates                        | 固定模板清单、源码相对目录、工具链就绪状态                                                                        |
| POST           | /api/builds                                 | 构建参数与 requestId → 202 `{build}`；校验、归属检查、排队                                                        |
| GET            | /api/builds?page=                           | 当前/历史构建、真实状态、产物可用性及当前账号 `latestB`，20 条一页                                                |
| GET            | /api/builds/:uuid                           | `{build}` 单任务状态                                                                                              |
| GET            | /api/builds/:uuid/artifact                  | 持有随机 UUID 链接即可下载成功产物；磁盘路径检查，不开放目录浏览                                                  |
| GET            | /api/builds/:uuid/log                       | 超管下载详细构建日志；包含源码准备、Gradle/Lint、签名、对齐、包信息、摘要及产物保存步骤                           |
| DELETE         | /api/builds/:uuid                           | JSON `{}`；仅完成/失败任务，删除记录及对应 APK、构建日志目录                                                      |
| GET/PUT/DELETE | /api/settings/translation                   | 配置状态 / 加密保存 / 清除                                                                                        |
| POST           | /api/settings/translation/verify            | 真实调用固定 Google v2 地址验证已保存密钥                                                                         |
| POST           | /api/snapshots/:id/translate                | 请求体 `{}`；仅固定合成标签                                                                                       |
| GET            | /api/logs/protocol、/api/logs/protocol/tail | `afterId`、`limit`（1–100）、`channel`                                                                            |
| GET            | /api/logs/protocol/export?date=YYYY-MM-DD   | 按 UTC 日期导出，单次上限 10000 条                                                                                |

HTTP 写请求（包括登录）要求 JSON 和 `X-Boundary-Request: 1`，跨站页面不开放 CORS。通用每分钟 300 次；登录/改密失败共享每 IP 每 15 分钟 10 次的限流；翻译每分钟 20 次；JSON 请求上限 32KB。错误返回 `{error}`：未登录/会话失效 401、校验失败 422、限流 429、不存在或关联错误 404。所有 API 响应 no-store；未知 API 不回落到 SPA HTML。

设备列表：`q`（100 字符）、`source=sample|import|api`、`a11y=enabled|disabled`、`status=online|offline`、`page`、`direction=asc|desc`。
排序白名单：`id,account,name,note,memo,app,app_version,source,brand,android,snapshots,battery,a11y,nodes,windows,last_seen,installed`。
每页 10 条，切换排序回第 1 页，节点数取最新快照。列表返回归属账号、应用名/版本、备忘数量和 `installed_at`。安装时间取 `device_credentials.registered_at`，升级时用更早的首次登记审计修复旧自动上线版本反复改写的问题；之后自动上线只续签 Token，不改首次登记时间。今日/昨日以北京时间分组：安装是该日首次登记数，离线/无障碍是该批设备的当前状态。没有任何可核对登记时间时每日指标为 null，页面显示“—”。

设备 HTTP 模型增加 `is_blacklisted`。拉黑后停止接入、关闭设备连接、清理内存图片及一次性上传许可；取消拉黑不恢复旧许可，原有有效凭证可再次连接。软删除撤销已登记设备凭证，设备/关联快照/图片/导出均退出正常读取范围（404），列表及统计不计入；历史数据库记录和私有文件保留用于审计，并非物理删除或手机端清除。自动上线与旧登记码重试都不能重新激活已删除设备。项目范围检查仍适用，后续新增角色需落实完整租户认证。

## WS /ws/panel

连接：`ws://127.0.0.1:8080/ws/panel?token=PANEL_JWT`，浏览器 Origin 须与工作区匹配。
最多 32 个面板连接，每连接最多 20 个只读设备订阅。

```json
{"type":"ping"}
{"type":"get_bot_list"}
{"type":"subscribe","sessionId":"PUBLIC_DEVICE_ID"}
{"type":"unsubscribe","sessionId":"PUBLIC_DEVICE_ID"}
{"type":"command","sessionId":"PUBLIC_DEVICE_ID","data":{"command":"GET_DEVICE_STATE","params":{}}}
{"type":"capture_viewer_heartbeat","sessionId":"PUBLIC_DEVICE_ID","data":{"viewerId":"UUID"}}
{"type":"command","sessionId":"PUBLIC_DEVICE_ID","data":{"command":"SCREENSHOT_NOW","commandId":"UUID","params":{"viewerId":"UUID"}}}
{"type":"capture_viewer_close","sessionId":"PUBLIC_DEVICE_ID","data":{"viewerId":"UUID"}}
```

- `connected`：明确公布此版本能力。
- `pong`：应用心跳回应，附服务端毫秒时间戳。
- `bot_list`：仅有效在线设备；历史完整列表通过 HTTP 获取。
- `subscribed` / `unsubscribed`：状态订阅确认；本身不启动截图。
- `capture_viewer_lease / capture_viewer_closed`：实时最新帧查看页的 12 秒租约状态。
- `command_dispatched / command_ack / screenshot_result / screenshot_ready`：分别表示已下发、设备已接收、设备执行结果、服务端已校验并缓存图片；只有最后一个表示网页可以读取图片。
- `accessibility_snapshot_ready`：订阅面板收到节点快照 ID、`viewerId`、窗口/节点数和时间，再用鉴权 HTTP 端点取得结构；WS 通知不携带整棵树。
- `get_device_state_response`：服务端已知状态，`cached:true`；不代表向设备请求后执行成功。
- `device_online` / `device_offline` / `device_status_update`：事件驱动广播给有效超管面板，覆盖全部设备；每次广播重新检查会话。
- `device_removed`：`data:{id,localId}`；面板刷新列表，当前详情返回列表，移除该设备订阅。
- `forced_logout` 包含 `code` 与可读 `message`，随后关闭码 4001。
- `ticket_expired`：仅面板连接票据到期；用仍有效的账号登录态换取新票据并重连。
- `kicked/password_changed/session_expired`：另处登录、改密或账号会话失效；前端停止重连、清除已显示的工作台并返回登录。

设备状态事件 `data` 统一：`{id,localId,name,model,osVersion,status,batteryLevel,accessibilityAlive,isLocked,isScreenOn,lastSeen,remark,source,isBlacklisted}`。
`id` 是公开设备 ID，`localId` 是本地路由数值 ID；Vue 在连接边界归一化成 HTTP 模型。未知锁屏/屏幕值为 null，绝不推测。订阅只推状态，不启动画面、读取凭据或下发设备操作。

截图浮窗每 5 秒续一次查看租约。浮窗关闭、页面卸载或面板 WS 关闭时，Node 撤销待执行项和未使用许可并发 `SCREENSHOT_VIEWER_CLOSE`；设备 12 秒收不到续租也自行停止最新帧循环。完整字段见 `boundary-screenshot-v2`。

## WS /ws/device（别名 /ws/session）

新登记设备凭证另含可撤销凭证 ID，每次消息验证设备与所有者状态；兼容 ScreenAgent 的 `register`、`device_ping` 和 `status.data.type=device_status`，并支持 `boundary-screenshot-v2` 白名单截图指令/逐帧回执与 `boundary-node-v2` 租约内脱敏节点结构，同时接受旧 B 包的 v1 回执。不接受同名 `screenshot` 元信息作为图片。该接入与下面的旧 CLI 状态凭证相互区分。

本机登记设备并签发 7 天独立 JWT：

```bash
npm run device:token -- TEST_DEVICE_001
```

命令仅显示凭证文件路径，Token 写入 `backend/.node-private/device-credentials/TEST_DEVICE_001.json`（0600）。现有合成示例或其他项目 ID 不覆盖。设备用 `Authorization: Bearer DEVICE_JWT` 连接；JWT 角色与项目须匹配，主体就是设备 ID；面板 Token 和设备 Token 不混用。此版尚无管理界面的逐令牌撤销功能，重签不会提前撤销旧令牌；旧令牌到期即失效。

```json
{"type":"status","sessionId":"TEST_DEVICE_001","data":{"type":"device_heartbeat","batteryLevel":80,"accessibilityAlive":true}}
{"type":"status","sessionId":"TEST_DEVICE_001","data":{"type":"screen_lock_status","isLocked":false,"isScreenOn":true}}
```

解析内层 `data.type`；可选字段有界限，额外字段剔除，正文不写库。`sessionId` / `botId` 若存在须与令牌主体相同。
连接建立后先等待有效状态上报，才计为在线；最近 90 秒有效状态算在线，时间以服务端接收为准。掉线立即移除在线状态，同设备新连接替换旧连接而不产生虚假离线。进程重启清空实时连接状态，不把历史心跳冒充当前连接。

拉黑/删除时主动以 `4001 / device_disabled` 关闭设备连接。所有设备身份解析同时检查设备状态，覆盖旧 CLI 状态凭证与新登记凭证；设备禁用后重连及 HTTP 上报均失败。

服务端每 30 秒 WS ping，未应答则终止；前端每 25 秒应用 ping、65 秒无 pong 重连，指数退避最大约 30 秒并加抖动。面板凭证在 9 分钟主动轮换。面板消息最大 16KB，设备消息为容纳最多 250 个节点放宽到 128KiB；两者每秒最多 30 条、待处理队列最多 30 条，发送缓冲超过 1MB 关闭慢消费者；不启用压缩。

## 审计与尚未接入的能力

完整截图会话的下一阶段契约见 [boundary-screen-v1 设计稿](SCREEN_CAPTURE_PROTOCOL.md)。其 `/api/v1/capture-sessions`、暂停/恢复、质量切换和历史帧端点尚未接入；不要与已实现的 `boundary-screenshot-v2` 最新帧租约混用。

审计仅保存项目、时间、设备标识、方向、通道、白名单消息类型、字节数，不保存完整载荷、密钥、节点正文或图片。连接保活不逐条写库，状态和业务读取写元数据。启动及每小时清理 7 天前记录。

账号审计另存 `account_audit`，保留登录成功/失败、退出、改密及设备拉黑/取消/删除事件、账号 ID、IP 和时间；设备管理事件包含公开设备 ID，不保存凭证或请求正文。设备管理同时记录真实项目范围的协议审计。

左侧「日志」入口使用 `GET /api/logs/protocol/tail?scope=client` 查看客户端请求元数据。B 包 HTTP 请求记录固定方法、固定路由、响应状态、耗时、字节数和已验证设备 ID；设备 WebSocket 记录连接、登记、心跳、截图结果与断开事件。日志不保存 Authorization、设备 Token、请求正文、截图内容或 URL 查询参数，保留策略与协议审计一致为 7 天；`GET /api/logs/protocol/export?date=YYYY-MM-DD&scope=client` 导出当天 UTC JSONL。

`/ws/bridge`、反向隧道、任意代理、二进制/base64 画面流、输入操作及原 PHP v1 诊断接口尚未接入。总台/子账号/验证码仍待实现；已加入 APK ID 到现有超管的首次登记归属。收到不支持的二进制帧返回 `unsupported_binary`，不透传。原 android-shell 不变；B 包 1.7 实现用户确认 MediaProjection 后的首图、有效网页租约内的串行最新帧，以及不含正文的结构节点预览。

## 网页构建参数

`POST /api/builds`：B 包使用 `{templateId,domain,appName,apkId?,batch?,packageName?,requestId}`，只接收后台域名；A 包使用 `{templateId:"installer-1.1",appName,homeUrl,packageName?,requestId}`，只接收 HTTPS 首页地址。给 B 包传 `homeUrl` 或给 A 包传 `domain` 均返回 422。requestId 为 UUID，相同提交重试幂等，换配置必须换 requestId。apkId 可空或省略：有效账号固定编号指定归属，未匹配可用账号或留空归默认接收账号（当前为超管），不创建新编号。响应 build 的 apk_id 为实际编号，requested_apk_id 保留输入，owner_account_id / owner_username / routing_reason 表示构建时归属快照；原因取 explicit / default_empty / default_unmatched。A 包必须存在同项目、同归属账号的最新成功 B 包，任务创建时固定 `payload_build_id/payload_sha256/payload_package_name`；缺少 B 返回 409，A/B 包名相同返回 422。batch 和 packageName 默认空，空包名服务端随机生成；模板决定 versionName/versionCode。B 包 domain 支持 local、已登记简称、HTTPS origin；A 包 homeUrl 只接受不带凭证的 HTTPS URL。构建器按模板 `visibleLauncher` 校验 B 包入口：1.7 的 MediaProjection 确认页必须存在，1.5/1.6 必须无 MAIN/LAUNCHER；A 包必须有桌面入口，否则包信息校验失败。

任务持久化 queued/building/succeeded/failed，stage 细分 preparing/compiling/signing/aligning/inspecting/publishing；失败返回经过归一化的 error_message，不泄漏工具输出。成功才返回 downloadUrl/sha256/size/artifactAvailable；日志文件存在时返回 logAvailable/logUrl，日志下载同样要求当前超管登录。最多 10 个未完成任务，单任务 20 分钟；额度/工具链错误返回 429/409/503。完成或失败的任务可确认删除，服务端按已校验 UUID 同时删除数据库记录、`files/apk-builds/<UUID>` 产物目录和 `build-work/<UUID>` 日志目录，并写入账号审计；排队中或构建中的任务返回 409。保存模板配置快照、提交者和 APK ID 归属，后续新增角色需统一加入租户检查。下载链接不携带 Token。详见 [模板与队列](../../android/apk-templates/README.md)。
