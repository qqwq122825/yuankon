# ScreenAgent 自动上线、心跳、实时最新帧与节点预览

日期：2026-09-30。当前版本为 B 包 `screenagent-1.7.4`。该版本不再申请 POST_NOTIFICATIONS 运行时权限；用户安装 B 包并在 Android 系统设置中启用其无障碍服务后可自动上线。桌面页可选择 MediaProjection 或 takeScreenshot 模式；MediaProjection 模式需要用户确认 Android 系统屏幕共享。B 包提供桌面模式选择页。用户不填写后台地址、登记码或设备凭证。后台域名与 APK ID 在构建时写入 B 包，设备凭证由 Node 静默签发并保存在应用私有存储。

## 用户流程

1. 在构建中心先构建 `screenagent-1.7.4` B 包。构建服务写入后台 HTTPS 域名、账号固定 APK ID、构建 ID、包名和版本。
2. 构建 A 包。A 包携带该账号最新成功的 B 包、摘要和包名。
3. A 包首次打开且未检测到 B 包时只显示「安装 B 包」。用户在 Android 系统安装器确认。
4. 返回 A 包后显示无障碍引导。Android 13 及以上若侧载 B 包的无障碍项被系统置灰，用户先打开 B 包应用信息并在系统菜单选择「允许受限设置」，再点击「打开无障碍」；旧系统直接进入无障碍设置。
5. 用户启用 B 包无障碍服务后，B 包自动上线并建立心跳，同时由无自定义内容的内部 Activity 立即打开 Android 系统 MediaProjection 对话框；用户确认后，前台服务持续显示共享通知并触发首图。B 包不暴露 MAIN/LAUNCHER。
6. 返回 A 包后进入配置的 HTTPS WebView。以后只要 B 包已安装，A 包直接进入 WebView。

## 自动归属

无障碍服务 `onServiceConnected()` 读取构建时写入的配置并调用：

```http
POST /api/client/online
X-Boundary-Request: 1
Content-Type: application/json
```

```json
{
    "deviceId": "由 Android ID 与 APK ID 派生的稳定标识",
    "apkId": "1",
    "brand": "Android 品牌",
    "model": "设备型号",
    "osVersion": "11",
    "appVersion": "1.7.0",
    "appName": "构建应用名",
    "batch": "可选批次",
    "buildId": "构建 UUID",
    "packageName": "实际 B 包包名"
}
```

Node 在事务中查询已启用的 `apk_routes.apk_id`，取得 `project_id` 和 `owner_account_id`，再按 `deviceId` 幂等创建或更新设备。既有设备的项目、APK ID 或账号不匹配时返回 409；拉黑、软删除或撤销凭证的设备返回 403。成功时自动签发 30 天内部设备 Token：

```json
{
    "deviceId": "...",
    "localId": 12,
    "apkId": "1",
    "owner": { "id": 1, "username": "mtx" },
    "deviceToken": "设备凭证字符串",
    "expiresAt": 1790611200000,
    "heartbeatSeconds": 20
}
```

用户界面不显示或要求输入该 Token。Token 到期或 WS 返回 401/403 时，B 包清除本地旧 Token 并重新调用 `/api/client/online`。旧 `/api/device-enrollments` 与 `/api/client/register` 仅为旧版 B 包兼容，当前账号页面不展示登记入口。

## 心跳、断网与重启

- 自动上线成功后连接 `/ws/device`，先发 `register` 和 `status`，随后每 20 秒发送 `device_ping`。
- Node 在 90 秒内未收到状态时将设备标记离线；WebSocket 关闭也立即发布离线状态。
- 重连退避为 1、2、4、8、16、30 秒，上限 30 秒。
- B 包使用 `ConnectivityManager.registerDefaultNetworkCallback`。飞行模式关闭、Wi-Fi/移动网络重新可用时，如果 WS 已断开会立即重连，不等待原退避计时器。
- Android 重启后会保留用户已启用的无障碍设置。系统重新绑定服务并调用 `onServiceConnected()` 时，B 包重复自动上线流程，并再次打开 Android 系统 MediaProjection 确认；B 包没有自定义页面。
- 进程被系统回收后逻辑相同：服务重新创建时先复用有效 Token，Token 无效则静默续签。

## 首图与实时查看

无障碍服务连接后，B 包立即通过透明内部 Activity 打开 Android 系统 MediaProjection 确认；用户确认且 WS 在线后，B 包申请 `initial_accessibility` 上传许可，从 `ImageReader.acquireLatestImage()` 取得第一张非空帧，压缩为 JPEG 并上传一次。Node 校验无障碍在线状态，同设备一分钟内最多接受一次首图，图片只在有界内存保存 5 分钟。拒绝系统确认时不会取得屏幕内容或产生截图。

网页打开设备详情并点击「开始」后：

1. 面板每 5 秒发送查看心跳，Node 签发 12 秒查看租约。
2. Node 下发 `SCREENSHOT_VIEWER_LEASE` 和 `SCREENSHOT_NOW`。
3. B 包只在截图模式就绪且租约有效时串行执行“申请上传许可 → 取帧（MediaProjection 的 `ImageReader.acquireLatestImage()` 或 AccessibilityService.takeScreenshot）→ 缩放到最大 540px 宽 → JPEG 50 → 上传”。当前 `screenagent-1.7.4` 在两种截图模式下上传成功后立即安排下一轮，不增加固定一秒间隔；若 ImageReader 暂时没有新图则返回空并在 50ms 后重新申请，不上传空帧。同一时刻最多处理一帧。
4. 浮窗同时开放返回、Home、多任务、锁屏、点亮和勿扰六个固定操作，以及显式提交到当前焦点输入框的 `TEXT_INPUT`；Node 与 B 包都要求同一 `viewerId` 租约有效。不接受坐标、手势、脚本或通用指令。
5. 页面关闭、面板 WS 断开或租约过期时，Node 下发 `SCREENSHOT_VIEWER_CLOSE`，B 包立即停止后续截图并拒绝快捷操作与文本发送，但设备心跳继续。`TEXT_INPUT` 只写入当前聚焦、可编辑、非密码输入框，不读取或回传已有内容。

## 实时无障碍节点预览

- `SCREENSHOT_VIEWER_LEASE` 同时是节点预览租约。B 包首次收到租约和后续的窗口/内容变化事件时，最快每 750ms 生成一份结构快照；结构未变时不重复上报。
- 客户端最多遍历 250 个节点和 24 层，仅序列化 `class_name/view_id/bounds/flags/text_present`。`text_present` 只是布尔值；节点正文、内容描述、密码和输入框已有值都不进入报文。
- 设备使用 `boundary-node-v2` 通过已认证 WS 上报。Node 再校验设备身份、`viewerId`、租约归属、坐标、父子引用、深度和总数，并剔除未知字段。设备 WS 上限 128 KiB，服务端上限 400 节点 / 32 层。
- 后台只在内存中保留当前 `viewerId` 的最新快照；`GET /api/devices/:id/accessibility-snapshot?viewerId=UUID` 要求登录账号且租约匹配。关闭两个实时浮窗、断开面板 WS、拉黑/删除/撤销设备或租约过期后清理。
- Vue 阅读器默认 300px，按屏幕坐标绘制边框。“翻译/原文”只在客户端类名和服务端固定角色词典之间切换，不将设备节点文本发送给翻译服务。A−/A＋只调整标签字号。

截图 multipart 字段固定为 `deviceId/apkId/batch/buildId/ts/file`，请求头 `X-Capture-Upload` 绑定一次性上传许可。JPEG 最大 2MiB、最多 400 万像素、最长边 4096px；1.7 模板在手机端先以最大 540px 宽、质量 50 编码，Node 再解码、旋转、去除元数据并重新编码，新帧替换旧帧。

## 源码位置

- 模式选择页：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/MainActivity.kt`
- 屏幕共享确认：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/ProjectionActivity.kt`
- MediaProjection 前台服务：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/capture/ProjectionCaptureService.kt`
- VirtualDisplay 与 ImageReader：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/capture/ProjectionController.kt`
- 自动上线与首图：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt`
- 网络恢复与 WS 心跳：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/net/AgentSocket.kt`
- HTTP 自动上线与上传：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/net/HttpUploader.kt`
- 设备私有 Token：`android/apk-templates/b-packages/screenagent-1.7.4/app/src/main/java/com/zaka/screenagent/net/DeviceSession.kt`
- Node 归属与上传：`backend/src/device-ingress.js`
- 查看租约与设备通道：`backend/src/websocket.js`

## 验证

代码交付需执行：

```bash
npm run check
npm run test:e2e
npm run build:screenagent
```

构建成功仅证明 Gradle、Lint、签名、对齐、包身份、MediaProjection 权限和可见共享入口检查通过。Android 系统安装返回、无障碍绑定、飞行模式恢复、进程回收和手机重启仍需在模拟器或登记测试设备分别验证。

## 1.7.4 手动授权回归与升级核对

- `versionName=1.7.4`、`versionCode=12`；桌面页标题和当前模式均显示运行版本。1.7.3 模板保留，不修改历史包。
- 无障碍绑定、网络重连、页面进入/恢复和网页查看命令均不启动屏幕共享授权。仅模式页的 MediaProjection 点击监听器发起请求。
- 授权 Activity 必须消费当前进程内的单次点击票据；旧 Intent、重放和进程重建不重新弹窗。屏幕旋转仅等待已在进行的结果。取消授权不自动重试；再次点击按钮才再次请求。切换 takeScreenshot 撤销待用票据并停止共享。
- 构建选择 1.7.4 后重新生成 APK；同包名、同签名、版本号递增才属于覆盖升级。随机包名会保留旧应用及其已开启的无障碍服务，请在手机无障碍列表核对具体包名与版本。浏览器缓存不负责触发 Android 的共享对话框。
- 真机回归：确认页面 v1.7.4 → 关/开该包无障碍（不弹共享）→ 打开模式页（不弹）→ 点击 MediaProjection（系统弹窗一次）→ 取消（不重试）→ 再次点击并确认 → 切换 takeScreenshot（共享停止）→ 重启/重连（不自动请求）。
- 部署升级后在构建中心选择新的固定模板；本机示例 APK 未写入生产后台域名，应使用构建中心的配置包测试实际上线。

## 1.8.0 快速诊断

API 调试提供开始诊断、停止诊断、复制诊断报告、导出 JSON；详细日志默认折叠。推荐操作：其他 App → Home 回桌面 → 打开其他 App。开始时如没有查看会话会启动现有查看租约与截图流，但不自动展开浮窗；停止时结束仅由诊断建立且未被用户打开查看窗口的租约，不关闭用户原有查看窗口。诊断只在用户开启期间附加收录。

鉴权 GET `/api/devices/:id/diagnostic-report?sessionId=<UUID>` 按设备与 session 精确查询，最多 5000 个事件并显式标记 truncated；不输出截图私有路径或图片二进制。报告关联客户端 nodes_snapshot/nodes_send 与服务端 nodes_received（capturedAt）、网页 nodes_ready/nodes_displayed（snapshotId）及 screenshot_ready/image_decoded（frameId）。网页附加事件保留当前页面内最近 1000 条，满额显式标记；刷新页面会失去网页内存事件，服务器端本次诊断日志仍可导出。客户端时间与服务器时间分开，不直接据时钟偏差推断网络耗时。网页开始操作不代表手机已收到调试状态，需等待心跳下发。

节点阅读器保持默认 300px、手机显示比例完整展开；超出视口由页面滚动。截图新图预解码并复用图片元素，失败保留上一帧直至过期；不把纯黑截图一律过滤，手机源黑帧仍需诊断。坐标新鲜度校验、本机控制同意、撤销与停止不变。

部署：提交固定模板/源码后在服务器 git pull --ff-only，npm ci、npm run build，重启现有 Node 服务，检查 /api/health 和构建模板 1.8.0。数据库和安装账号不重置。APK 构建/Lint/签名验证与真实手机 App→Home→App 验证分别报告。

### 1.8.3 接收断点诊断

API 调试开启期间，节点校验失败记录 `nodes_rejected`：采集时间、节点数量、报文字节数、固定原因码及最多五个字段路径/校验类型，不记录拒收值或异常正文。WebSocket 超过既有 128 KiB 限制记录固定原因码 `websocket_payload_limit`；限制和鉴权不变。成功回执增加采集时间、节点数量和报文字节数，供后续客户端确认。`queued=true` 仍仅表示发送队列接受，不代表服务端接受。

### 实时节点无效矩形兼容

1.8.3 服务端/网页修复：仅实时节点路径允许数值合法但边界倒置的矩形保留节点 ID 和父子关系，坐标归零、visible/clickable 关闭并标记 geometry_status=invalid。有效节点坐标不变。历史快照校验仍严格；引用、循环、深度、数值范围及数量限制不变。diagnostics 增加 invalid_bounds_count/empty_bounds_count；nodes_received 增加对应数量。阅读器不创建倒置、零面积或完全在视口外的绘制框，nodes_rendered 的 key 列表只包含实际绘制节点。无需 APK 升级。

### 1.8.4 本机桌面诊断授权

新 APK 默认停止节点读取/上传，网页不能开启或延长本机授权。手机「开始桌面节点诊断」确认后仅默认 HOME 包与本应用允许读取，继续要求有效网页租约。密码/可编辑输入内容保持剔除。授权内存保存，最多5分钟；可见底部停止条、应用停止按钮、关闭查看、断网、销毁均停止。未授权或非诊断应用不遍历节点正文。此前 fc4348a 的服务器 live 坐标兼容修复仍是必要更新；需要真机报告验证 launcher 图标是否暴露及 received/rendered 差异。新功能不授予远程点击权限。

### 到期总台的已登记设备

总台未提前续期而到期时，服务器自动将其及子账号的已登记设备/历史记录转给平台超管。原设备 ID、APK ID、独立凭证 ID 与首次注册时间保留，原项目设备凭证失效；旧 WS 被关闭，B 包按既有 401/403 重连流程重新请求 `/api/client/online`，服务器仅对接管台账匹配的同一设备 + 原 APK ID 返回超管归属与平台设备凭证。不会把到期 APK 路由整体指向超管，到期路由的新设备继续拒绝；拉黑、软删除或撤销设备仍拒绝。总台后来续期也不自动抢回已接管设备；续期后的新设备照常按原账号编号登记。本地 HTTP/WS 合成设备测试不等同于真机重连验收。
