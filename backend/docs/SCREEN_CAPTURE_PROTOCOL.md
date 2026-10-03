# 截图会话协议 · boundary-screen-v1

日期：2026-09-28。**协议设计稿 / 待实现，不代表当前后台或 APK 已接通。**

设备归属、无障碍首图和网页租约内实时最新帧已经实现，见 [ScreenAgent 接入说明](SCREENAGENT_INGRESS.md) 与 [boundary-screenshot-v2](SCREENSHOT_COMMAND_PROTOCOL.md)。本文件仍是完整截图会话的下一阶段设计；其版本化端点、暂停/恢复、质量切换与历史帧尚未实现。已上线的 12 秒最新帧租约与本稿的完整会话租约不是同一状态机。

本次先固定截图链路，不更换 APK 模板，不执行附件中的补丁。当前实现仍以 [Node 契约](NODE_PROTOCOL.md) 为准。本稿收敛并更新 [APK 基础设计](APK_BASE_DESIGN.md) 第 8 节的截图方案；节点结构上报另行设计，不与图片混成一个协议。

## 1. 先说结论

**本节描述未来连续查看：网页点击开始 → 手机用户确认本次共享 → 手机采样 JPEG → HTTPS 上传 → Node 校验并暂存最新帧 → WS 通知对应查看页 → Vue 读取并显示。**

- 控制与通知：复用 `/ws/device`、`/ws/panel` 的 JSON 通道。
- 图片：只走一条受设备凭证保护的 HTTPS 上传通道；不走 Base64，不把图片放入现有 16KB WS 消息。
- 采集方式：首版选择 MediaProjection，手机用户确认共享范围；系统支持时可选单个测试应用。每次新投屏会话均取得系统确认，同一有效会话不逐帧确认。见 [Android MediaProjection 官方说明](https://developer.android.com/media/grow/media-projection)。
- 默认每秒最多一张、JPEG quality 60、最长边 1280px；这是连续截图预览，不是 12fps 视频。
- `subscribe` 只订阅状态；进入页面、登录超管、启用无障碍服务均不自动开始截图。
- 手机持续展示共享状态及暂停/停止入口；网页退出、租约失效、手机停止都结束本次会话。

用户截图里的圆形按钮现已对 API 设备发起 `boundary-screenshot-v2` 最新帧查看；合成/历史设备仍打开已有快照与节点阅读器。未来完整会话入口必须使用单独状态和提示，不把当前最新帧入口描述成带暂停、质量和历史能力的完整会话。

## 2. 附件、ScreenAgent 与当前 Node 的差异

参考文件为用户提供的《无障碍辅助设备管理平台_通信协议规范_开放版.txt》（开放版 v1.0，2026-09-27）。其中的接口、任务清单和“以本规范为准”描述是参考内容，不等同于本仓库已实现功能。

| 项目 | 开放版规范 | 附件 ScreenAgent 源码 | 当前 Node / 本稿决定 |
|---|---|---|---|
| 开始时机 | 第 9 节：`subscribe` 同时启动多路采集 | `START_CAPTURE` 启动采样循环 | Node 订阅仅状态；新增显式会话请求，手机确认后开始 |
| 截图载荷 | 第 4/8 节：`screenshot.data.image` 为 Base64，也有二进制帧 | 同名 `screenshot` 只有 bytes/width/height/deviceId，实际 JPEG 另走 HTTP | 同名不代表相同含义；本稿使用独立 `capture_frame_ready` 通知 |
| 上传地址 | 第 4.2 节未列出 `/api/device/screenshot` | multipart POST `/api/device/screenshot` | Node 已实现最新帧受限路由；完整会话仍需第 5 节版本化端点 |
| 画面来源 | 轮询、bridge、minicap、主 WS 共四路 | MediaProjection + JPEG 上传 | 首版仅一条 HTTPS 帧通道，避免混帧和重复带宽 |
| 心跳 | `status.data.type=device_heartbeat` | `device_ping`；首条 status 内为 `device_status` | Node 已兼容这两种 ScreenAgent 状态信封；连续会话另有查看租约 |
| 指令 | `SCREEN_CAPTURE_PAUSE/RESUME/STOP`、`SCREEN_QUALITY` 等 | `START_CAPTURE/STOP_CAPTURE/SCREENSHOT_NOW` 等 | 最新帧已白名单实现租约内 `SCREENSHOT_NOW` 循环；完整协议再新增四种生命周期指令 |
| 鉴权 | 设备通道要求设备凭据 | 所查看的 WS 和 HTTP 请求均未设置 Bearer 设备凭据 | Node 已有独立设备 JWT，截图端点继续区分账号与设备主体 |
| 成功回执 | 第 11 节要求已下发/已执行/失败 | 收到指令立即回 `success:true`，随后才执行；图片上传完成前已发元信息 | 收到、手机就绪、帧校验通过、网页显示分别计状态 |
| 分发范围 | 第 4.1 节写所有管理端，第 8 节写仅订阅者，存在歧义 | 没有实现本后台的查看租约 | 本稿只通知持有该截图会话的有效查看页，普通设备订阅不足以取得图片 |

**地址已经按包职责拆开：** B 包的 `HttpUploader.kt` 只从 `serverUrl` 推导 API origin，`agent_config.json` 不再包含 `homeUrl/webUrl`；A 包的 `installer_config.json` 单独保存 HTTPS 首页。主页不会参与 B 包登记、心跳或截图上传地址计算：

| 字段 | 含义 |
|---|---|
| `homeUrl` | A 包桌面入口使用的 HTTPS 首页，不写入 B 包 |
| `serverUrl` | B 包工作台后端 origin；HTTP API 与 WSS 设备地址均从这里推导，不从主页推导 |
| `apkId` | APK 业务归属提示，不是凭证，也不直接决定上传者的项目或账户 |

设备 Token 不经跳转转发到其他 origin；设备 API 禁止跨域重定向跟随。构建机器人仅生产/交付 APK，不中转实时截图。总台专属域名、设备登记及 APK ID 分配按 [账号方案](ACCOUNT_DESIGN.md) 单独落实。

## 3. 版本和标识

| 名称 | 例子 / 约定 |
|---|---|
| `templateVersion` | `1.0`、`1.1`，后台选择的固定源码模板版本 |
| `appVersion` | APK 展示版本，与协议独立 |
| `protocol` | 固定 `boundary-screen-v1`；后续不兼容变化升为 v2，不猜测旧载荷 |
| `deviceId` | 已登记公开设备 ID，由设备 JWT 主体确定 |
| 信封 `sessionId` | 沿用现有含义：**设备 ID**，不是截图会话 ID |
| `captureSessionId` | Node 创建的 UUID，每次重新开始都不同 |
| `viewerId` | 查看页实例 UUID，绑定当前账号登录会话和面板连接；自身不是鉴权凭据 |
| `requestId` / `commandId` | 创建请求幂等键 / 服务端指令 UUID，分别关联 HTTP 重试与设备回执 |
| `generation` | 会话内采集代次，从 1 开始；暂停、恢复时递增，作废在途旧帧 |
| `seq` | 本会话采样序号，从 1 递增；丢帧可以跳号，恢复时也不回退 |
| `frameId` | 服务端生成的不可复用帧 UUID，不用客户端文件名寻址 |

新设备在现有状态心跳之外，通过独立 `capture_capabilities` 消息声明协议、`methods:["mediaprojection"]`、`formats:["image/jpeg"]` 及采样上限。未声明支持的模板不显示为可开始；当前 android-shell 就属于尚未接入。能力声明只是设备报告，不等于已得到本次系统确认。

## 4. 点击开始后的状态与时序

```text
Vue 查看页                     Node                         手机 APK
    | POST 创建会话              |                              |
    |<-- 202 requested ----------|                              |
    | 每 3 秒续查看租约           |-- SCREEN_CAPTURE_START ----->|
    |<-- awaiting_consent -------|<-- command_ack: accepted -----|
    | 等待手机用户主动打开请求     |                 展示接收方、时长、共享范围
    |                            |                 用户确认系统共享对话框
    |<-- starting ---------------|<-- capture_ready -------------|
    |                            |<-- capture_lease_request -----|
    |                            |-- capture_lease_grant -------->|
    |                            |                 有效租约内开始采样 JPEG
    |                            |<-- HTTPS multipart frame -----|
    |                            | 校验后替换内存最新帧            |
    |<-- capture_frame_ready ----|-- 201 帧接收结果 -------------->|
    | GET 受控帧地址              |                              |
    | 校验会话/代次/序号并显示      |                              |
    | POST 停止 / 退出页面         |-- SCREEN_CAPTURE_STOP ------->|
    | 清空实时画面                | 清空内存帧          停止采样并释放投屏资源
```

- 网页发起的是共享请求；手机通过可见应用页面/通知呈现待确认请求，不强行拉起界面。手机未确认之前不采样、不上传。
- `requested`：请求已创建；`awaiting_consent`：设备接受请求，等待手机确认；`starting`：手机资源就绪，等待首帧；`live`：服务端收到有效帧。浏览器成功解码后才显示“画面已显示”，服务端 `live` 本身不证明浏览器已显示。
- `paused`：停止采样与上传，双方清除在途图片和实时预览；有效投屏资源可暂留，查看租约仍须有效。手机主动暂停后，网页恢复只是请求，须手机继续确认；系统已结束投屏则新建会话，不复用失效的投屏令牌。
- `stopped` / `expired` / `failed` 是终态；迟到回执、迟到帧和重新连线都不复活它们。设备锁屏、系统停止投屏、身份失效和异常退出均结束会话。
- Node 给状态事件分配递增 `stateRevision`；控制意图变化递增 `generation`，ACK 按 `commandId` 关联。设备忽略旧代次指令，Node 忽略旧代次就绪与迟到执行结果。手机主动暂停/停止报告优先：只要设备身份与当前截图会话匹配，即关闭收帧门并撤销待恢复请求，不因代次竞态丢弃停止意图。网页暂停/停止也先关闭服务端收帧门，再通知手机，不等待手机 ACK 才关闭。
- 首帧超过 10 秒显示失败并停止；手机确认请求最多等待 60 秒。首帧延迟从有效采集租约发出时计，不把用户确认耗时算成网络延迟，不承诺固定 250ms 首帧。
- 首版每设备最多一个截图会话、一个查看页；其他页创建返回 `409 capture_busy`，不自动抢占。当前超管可停止全部会话，但查看图片仍须显式创建并取得手机确认。后续角色扩展须统一加项目/成员范围。

## 5. HTTP 接口（全部为待新增）

账号写接口复用现有账号认证、JSON 和 `X-Boundary-Request: 1`；设备接口使用独立 DEVICE_JWT，不接受账号 Token，不套用“所有写入必须 JSON”的浏览器中间件。设备身份、项目归属由服务端确定，路径 ID 不是访问凭证。

| 主体 / 方法 | 路由 | 用途 |
|---|---|---|
| 账号 POST | `/api/v1/capture-sessions` | 创建，返回 202 与会话状态；不表示已截图 |
| 账号 GET | `/api/v1/capture-sessions/:id` | 读取状态、代次及可用的最新帧元信息，供 WS 重连补齐 |
| 账号 POST | `/api/v1/capture-sessions/:id/renew` | `{viewerId}` 续查看租约，必须匹配账号会话和查看页 |
| 账号 POST | `/api/v1/capture-sessions/:id/actions` | `{viewerId,requestId,action:"pause"|"resume"|"stop"}`；终态 stop 幂等 |
| 设备 POST | `/api/v1/device/capture-sessions/:id/frames` | `multipart/form-data`，仅 `meta` 和 `file` 两部分 |
| 账号 GET | `/api/v1/capture-sessions/:id/frames/:frameId?viewerId=...` | 当前会话的临时 JPEG；校验登录态、查看租约及查看页绑定 |

创建请求示例（所有值为合成示例）：

```json
{
  "protocol": "boundary-screen-v1",
  "deviceId": "TEST_DEVICE_001",
  "viewerId": "00000000-0000-4000-8000-000000000001",
  "requestId": "00000000-0000-4000-8000-000000000002",
  "capture": { "method": "mediaprojection", "format": "image/jpeg", "intervalMs": 1000, "maxLongEdge": 1280, "quality": 60 },
  "maxDurationSeconds": 900
}
```

Node 返回 `{protocol,captureSessionId,deviceId,viewerId,state,generation,stateRevision,confirmDeadlineAt,viewerLeaseExpiresAt}`。同一账号会话和同一 `requestId` 重试返回同一结果；相同键不同参数返回 409。会话最长默认/上限 900 秒，手机可选更短时长；硬时限从有效采集租约发出时开始，续租不延长硬时限。

上传头 `Authorization: Bearer DEVICE_JWT`；`meta` 为 UTF-8 JSON，最多 2KiB：

```json
{
  "protocol": "boundary-screen-v1",
  "captureSessionId": "00000000-0000-4000-8000-000000000003",
  "generation": 1,
  "seq": 1,
  "capturedAt": 1790553600123,
  "width": 720,
  "height": 1280,
  "rotation": 0,
  "mime": "image/jpeg"
}
```

`file` 是 JPEG 原始字节，不是 Base64 或图片 URL；文件名忽略。宽高指最终编码图片尺寸，需与解码结果一致；像素已转正，`rotation` 只报告源显示方向（0/90/180/270），Vue 不再次旋转。手机选择的共享区域随 `capture_ready` 报告；准确范围未知时标记 `system_selected`，不根据图片形状猜测。旋转或窗口尺寸改变后清空旧采样缓冲，按新尺寸发送，不创建并复用第二次投屏令牌。

接收步骤固定：

1. 读取请求体前校验设备 JWT、登记状态、设备与会话关联、状态和租约；不接受任意 deviceId/apkId/projectId 改归属。
2. 单图最多 1MiB；整个 multipart 最多 1MiB + 16KiB、严格两部分；超限中止读取。仅接收单幅 JPEG，检查实际格式并限制解码像素数。
3. `width/height` 均为正整数，最长边不超过会话配置且最多 1280px；像素数最多 1,638,400。`seq` 为正安全整数，必须大于上次已接受序号；`capturedAt` 为毫秒时间，仅用于诊断，排序和租约不信任手机时钟。
4. 解码成功后移除元数据并重新编码；尺寸变化须与本帧元信息一致。发布前再次校验登录会话、设备凭证、代次、租约及序号，防止解码期间发生停止/改归属的竞态。
5. 原子替换该会话的最新内存帧，生成 `frameId` / `receivedAt`，再发 WS 通知。201 返回 `{captureSessionId,generation,seq,frameId,receivedAt}`，仅表示服务端接受，不表示网页已显示。

所有错误统一 `{error:"CODE",message:"可展示说明"}`。401 凭证失效；404 不存在或越范围；409 `capture_busy/stale_generation/stale_frame`；410 `capture_ended/frame_expired`；413 超出大小；415 格式错误；422 字段错误；429 频率/并发受限并附 Retry-After。响应、图片和状态全部 `Cache-Control: no-store`，不走公共静态目录。

## 6. WS 事件和指令（全部为待新增）

沿用单一嵌套指令信封，所有新消息携带 `protocol`；设备相关消息的外层 `sessionId` 仍是设备 ID，查看页绑定消息不带该字段：

```json
{
  "protocol": "boundary-screen-v1",
  "type": "command",
  "sessionId": "TEST_DEVICE_001",
  "data": {
    "command": "SCREEN_CAPTURE_START",
    "commandId": "00000000-0000-4000-8000-000000000004",
    "params": {
      "captureSessionId": "00000000-0000-4000-8000-000000000003",
      "generation": 1,
      "capture": { "method": "mediaprojection", "format": "image/jpeg", "intervalMs": 1000, "maxLongEdge": 1280, "quality": 60 },
      "maxDurationSeconds": 900
    }
  }
}
```

| 消息 / 方向 | data 内容与语义 |
|---|---|
| `capture_capabilities` 设备→服务端 | `protocols,methods,formats,maxLongEdge,minIntervalMs`；连接后报告，不替代状态心跳 |
| `capture_viewer_bind` 查看页→服务端 | `viewerId`；创建会话前将查看页绑定到当前已认证面板 WS / 账号登录会话，服务端回复 `capture_viewer_bound`；HTTP 创建/续租检查该绑定 |
| `command` 服务端→设备 | 仅 `SCREEN_CAPTURE_START/PAUSE/RESUME/STOP`；`commandId` 和会话/代次必填，START/RESUME 同时附有效配置 |
| `command_ack` 设备→服务端 | `captureSessionId,generation,commandId,result:accepted|rejected,reasonCode`；accepted 仅确认接收，不是执行完成 |
| `capture_ready` 设备→服务端 | `captureSessionId,generation,commandId,method,sharedRegion,maxDurationSeconds`；手机已确认且资源就绪，随后仍须获得采集租约 |
| `capture_state_report` 设备→服务端 | `captureSessionId,generation,state:paused|stopped|failed|resume_requested,reasonCode`；手机本地暂停/停止先执行后报告，断网也执行 |
| `capture_state` 服务端→查看页/设备 | `captureSessionId,generation,stateRevision,state,reasonCode,latestFrame?`；服务端验证后决定权威状态，不原样转发客户端报告 |
| `capture_lease_request/grant` 设备↔服务端 | 见第 7 节，不作为设备上线心跳 |
| `capture_frame_ready` 服务端→查看页 | 下例；只在图片已校验并存入临时缓存后通知 |

手机发出 `resume_requested` 或网页请求恢复时，Node 验证仍为 paused 且查看租约有效，分配新代次并发 RESUME；收到匹配的 `capture_ready` 后才进入 starting 并允许申请采集租约。恢复等待期间保持 paused，旧代次帧作废；用户未继续确认则 60 秒后结束请求。`sharedRegion` 取 `single_app|display|system_selected`，仅说明用户共享范围，不上传应用正文或窗口内容描述。

面板重连时重新发送 `capture_viewer_bind`，仅同一有效账号登录会话可恢复未过期的原绑定；一个查看页最多绑定一个 WS，新绑定替换旧连接绑定。其他 viewerId 不接管既有截图会话。新增消息均使用显式白名单 schema；不支持的协议版本返回 `unsupported_protocol`，不透传未知类型。

`reasonCode` 使用白名单，如 `user_declined,user_paused,user_stopped,lease_expired,session_limit,screen_locked,projection_stopped,device_offline,viewer_gone,credential_expired,first_frame_timeout,capture_error`。异常正文/堆栈不穿透到协议。设备重复收到相同 `commandId` 只重发原结果，不重复提示用户或创建投屏资源。

```json
{
  "protocol": "boundary-screen-v1",
  "type": "capture_frame_ready",
  "sessionId": "TEST_DEVICE_001",
  "data": {
    "captureSessionId": "00000000-0000-4000-8000-000000000003",
    "generation": 1,
    "seq": 1,
    "frameId": "00000000-0000-4000-8000-000000000005",
    "width": 720,
    "height": 1280,
    "receivedAt": 1790553600250
  }
}
```

Vue 由会话 ID 和帧 ID 构造同源受控 GET 路径，不接受设备提供任意 URL。使用账号 Cookie 读取图片，解码前后均检查会话、代次、序号；只替换更新帧，释放旧 Object URL / ImageBitmap。每页最多一个取图/解码任务，期间只记最新通知。帧已被替换返回 410 属于正常丢帧，跳到最新帧，不回放旧帧。状态 GET 可补齐漏掉的最新帧通知。

## 7. 租约、背压和停止规则

### 两端都能独立停止

- 创建请求即建立 **10 秒查看租约**，Vue 每 3 秒续租；确认期间也续租。续租须当前账号登录会话、viewerId、对应有效面板绑定仍成立；后台标签页停止续租，不承诺浏览器后台计时可靠。
- 手机就绪后每 3 秒发送一次 `capture_lease_request`：`{captureSessionId,generation,requestId}`。Node 只有在查看租约有效且状态为 starting/live/paused 时回复同 ID 的 `capture_lease_grant`：`{captureSessionId,generation,requestId,validForMs}`；paused 只维持会话资源，不授予采样/收帧资格。上限 10000ms，且不超过查看租约和会话硬时限的剩余时间。
- 手机保存发出请求的单调时钟时刻，以 **发送时刻 + validForMs** 为本地停止期限，而不是“收到响应后再加 10 秒”。只接受当前未完成请求、同一代次的响应；旧响应/重复响应丢弃，已超过期限的授权不启动采样。这样网络延迟和手机系统时间修改不会额外延长共享。
- 手机只有本地确认、资源就绪、有效租约三项同时成立才采样。设备心跳、截图上传和 TCP/WS ping 都不续查看租约。
- 网页主动停止、账号被挤下线/退出、改密、权限或设备归属变化：Node 立即关闭收帧/取图、清缓存并尽力发送 STOP。手机在收到 STOP 时立即停止；断网丢失 STOP 时靠本地租约期限停止，最长不超过此前已授予的剩余 10 秒。
- 设备 WS 断开立即使本次截图会话终止；手机也在发现断开时停止。面板短暂断线期间不续租，可在未过期的原租约内用同一账号会话/viewerId 重新绑定；确认退出页面则立即停止。重连晚于到期时间须重新发起手机确认。
- 暂停使代次递增并清空图片，继续维持有效会话租约；恢复再换新代次。停止/到期释放 MediaProjection、Surface、ImageReader 和队列，服务进程重启保持停止态。锁屏/系统 `onStop()` 同样清理；系统投屏令牌只用于该次投屏。平台生命周期依据见上方 Android 官方说明。

### 慢网不堆图

- 配置范围：`intervalMs` 1000–5000；`maxLongEdge` 320–1280；`quality` 40–80。实际值在创建时校验并固定到会话，不接受任意无界参数。
- 手机同一时刻最多一项“采样→编码→上传”任务；在途未完成跳过下一次采样，不建无界任务队列。设备侧优先内存处理，不累计临时图片。
- 单帧请求总超时 5 秒，并随暂停/停止/本地租约到期取消；失败丢弃，不重传旧帧。429 按 Retry-After 延迟新采样；401/404/410 结束会话；旧代次/序号 409 丢弃并核对当前状态。
- Node 同设备仅一个解码任务，最多每秒接受一帧；默认全局最多 8 个活跃会话、2 个并行解码任务、32MiB 编码帧/上传缓冲总预算。超出返回 429，不无限排队；解码工作内存仍需另行压测预算，32MiB 不代表进程总内存上限。
- 每个会话只保留最新一帧，最长 10 秒，替换即释放；暂停、停止、到期及退出时立即清理。SQLite 只记录会话审计元数据（身份、时间、状态、原因、计数），不存图片/Base64/正文；代理和应用请求日志也不记录 multipart 内容。
- 网页 3 秒无新帧显示“画面延迟”，10 秒无新有效帧结束会话；旧图不能持续标成实时。服务端帧时间和浏览器到达时间分别用于审计和 UI，本机/手机时钟不做精确延迟承诺。

## 8. 实施顺序及验收门槛

本稿没有新增任何路由、截图权限、构建模板或采集代码。当前 Node 仍本机监听；手机接入需要另行完成 HTTPS/WSS、设备登记/撤销和部署入口，不通过删除现有 Host/Origin 检查来接通。

1. **Node**：会话状态机与受限设备 API、身份范围、查看/采集租约、图像校验和临时缓存；先用生成的合成图片测链路。
2. **Vue**：现有紧凑圆形入口与截图浮窗接状态机；历史图与实时图明显区分。首版只更新截图浮窗；节点阅读器仍标注历史快照时间，不假装同步更新。
3. **APK**：选择并登记受控的 MediaProjection 模板版本，修正 API 地址/鉴权/心跳/命令；加入本次确认、持续可见状态、暂停/停止、过期清理、旋转与慢网处理。ScreenAgent 只作代码参考，既有 android-shell 继续保留。
4. **构建中心**：模板声明 `supportedProtocols`；模板 1.0 与 1.1 可同时支持截图协议 v1。APK ID 与收件账户映射、机器人构建另测，不复用图像会话凭据。

必须覆盖：

- 正常确认与连续帧；取消确认/60 秒超时；无能力、设备离线、无历史快照；重复开始只创建一次。
- 账号与设备 Token 混用、伪造 deviceId/apkId、跨项目/跨设备/跨查看会话、旧登录态和归属变更均隔离。
- 伪 JPEG、损坏文件、超体积/像素、字段重复、超字段数；解码期间暂停/停止/到期时不发布图片。
- 重复/乱序 seq、旧 generation、迟到 ACK/租约响应、并发取图与帧淘汰；停止后不恢复旧预览。
- 页面关闭/崩溃/后台节流、手机/服务器断网、进程重启；没有 STOP 报文也在本地期限停止。
- 手机主动暂停后网页恢复仍等手机操作；锁屏、系统停止、权限撤销、旋转、受保护窗口按平台实际结果处理。
- 慢网、慢解码、内存预算、计时偏移和并发压力；桌面/窄窗口横向滚动与键盘操作。
- Android 逐机型实测确认提示、持续状态、暂停/停止、资源释放及首帧耗时。代码测试和编译结果不代替真机结果。

### 本次核对位置

- 当前按钮：`frontend/src/pages/DeviceDetail.vue` 的 `openBoth()`、`orbit-launch`。
- 当前 Node：`backend/src/protocol.js`、`backend/src/websocket.js`、`backend/src/app.js`。
- 附件（未修改）：`/Users/xxx/Downloads/ScreenAgent/app/src/main/java/com/zaka/screenagent/net/Protocol.kt`、`AgentSocket.kt`、`HttpUploader.kt`，及 `capture/CaptureService.kt`、`MainActivity.kt`。
- 参考规范：第 3、4、5.2、8、9、10、11 节；只取截图会话所需部分，不接入其他内容上报、任意透传或设备操作。

## 1.7.8 横屏与单击
查看器固定宽度，按最新有效帧 width/height 更新 aspect-ratio；object-fit:contain 的黑边不映射。图片未加载、过期、离线、等待上一条回执，或按下/松开期间换帧时不发送。

`SCREEN_TAP` 的 params 严格为 `{viewerId, frameId, x, y}`，x/y 为 0..1 的数值；禁止附带文本、时长、路径或脚本。服务端校验当前 socket 查看租约、设备在线、同设备/账号/查看者、五秒内帧和最新尺寸，保存每设备最多 32 条短期帧元数据。手机保存成功上传帧到捕获时真实 display 的宽高/rotation 关联，旋转后旧帧拒绝；缩放辅助功能开启时也拒绝。MediaProjection 使用全屏共享配置；截图尺寸与真实显示比例不符则不建立操作映射，不猜测单应用共享偏移。

手机本机模式页「运行操作」弹窗确认才开启两分钟授权，不落盘、不通过服务器续期；可见 accessibility overlay 提供停止入口，远程点击不能触发该停止控件。首次单击绑定 viewerId，关闭租约、断线、模式切换、进程终止和期限到达停止授权。单击使用单点 50ms stroke，`onCompleted` 后返回 `accepted/tap_completed`；取消、过期、未授权、忙碌、旧帧返回 rejected，无回执时网页五秒结束等待，不自动重发。

Android 14+ 使用 onCapturedContentResize 调整已有 VirtualDisplay 和 ImageReader Surface，不重复创建 VirtualDisplay；较旧系统检测真实 display 尺寸变化。参考：[Android MediaProjection](https://developer.android.com/media/grow/media-projection)、[AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)。

网页测试使用合成 JPEG 与模拟设备 WS，不能据此认定真机触摸已成功；真机需检查纵屏、左右横屏、180°旋转、系统导航栏、缩放辅助功能、停止入口、租约超时和断线。

「运行操作」在 1.7.8 也统一门控既有 DEVICE_ACTION 与 TEXT_INPUT；截图/状态查看独立，不开启操作也可查看。相同本机两分钟授权仅绑定一个查看者，其他查看者命令不会覆盖/续期授权。

## 1.7.8 直传修订（2026-10-03）
两种实时截图模式共用直接帧接口：POST `/api/device/screenshot`，头 `X-Capture-Mode: viewer-stream`，multipart 为 deviceId/apkId/ts/commandId/viewerId/file。没有 X-Capture-Upload，也不调用 screenshot-session。commandId/viewerId 是已有 WS 指令的关联字段，不是新的许可请求。设备 Bearer 身份、账号归属、撤销与鉴权保留；服务器在 JPEG 解码前和发布前均检查当前查看心跳/指令、设备心跳。查看租约15秒、设备心跳90秒失效就拒收；客户端 WS 断线立即取消正在进行的上报，查看心跳失效也停止。

默认无桌面 API 截图与手动授权的 MediaProjection 仍受同一有效查看租约约束；这项直传优化不替代屏幕共享授权，不改变「运行操作」默认关闭和本机停止机制。历史模板首图/手动单张接口保持一次性 uploadId 兼容。

无 EXIF/XMP/ICC/IPTC/orientation 的直传 JPEG 保留客户端压缩结果，但仍进行限像素和实际解码校验；有元数据的图片仍正规化去除元数据。最新图与短期历史合计最多16MiB；每设备近期图片最多30张/3秒，达到内存上限先丢弃近期历史，避免图片GET与下一帧上传竞态。旧单张路径仍只暴露最新图片。

网页使用 screenshot_ready WS 元数据，不逐帧查询JSON；同一时刻只下载一张图，等待队列仅保存最新帧，以 Blob URL 显示并释放旧 URL，避免高速更新反复取消图片加载。3秒无新元数据才轮询恢复。HTTP普通API维持300次/分钟默认限制；图片流另设每IP6000次/分钟和已鉴权设备直传30次/秒限制，保留2MiB单图、2个全局处理并发、每设备1个并发。实际帧率取决于截屏API、压缩、网络RTT与负载，不以合成联调结果宣称真机帧率。

MediaProjection成功帧采用最短40ms本地周期（上限约25帧/秒，包含捕获与上传耗时），避免低延迟环境超过服务器30帧/秒限流后出现周期性500ms重试；慢网络不额外等待。takeScreenshot保留系统API节流，不宣称突破系统截图频率限制。
