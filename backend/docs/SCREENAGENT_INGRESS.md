# ScreenAgent 自动上线、心跳、实时最新帧与节点预览

日期：2026-09-29。当前版本为 B 包 `screenagent-1.7.2`。该版本不再申请 POST_NOTIFICATIONS 运行时权限；用户安装 B 包并在 Android 系统设置中启用其无障碍服务后可自动上线；服务连接后立即打开 Android 系统屏幕共享对话框，用户确认后才取得屏幕内容。B 包没有桌面入口或自定义页面。用户不填写后台地址、登记码或设备 JWT。后台域名与 APK ID 在构建时写入 B 包，设备凭证由 Node 静默签发并保存在应用私有存储。

## 用户流程

1. 在构建中心先构建 `screenagent-1.7.2` B 包。构建服务写入后台 HTTPS 域名、账号固定 APK ID、构建 ID、包名和版本。
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
    "deviceToken": "内部 JWT",
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
3. B 包只在 MediaProjection 活动且租约有效时串行执行“申请上传许可 → `ImageReader.acquireLatestImage()` → 缩放到最大 540px 宽 → JPEG 50 → 上传”。当前 `screenagent-1.7.2` 在上传成功后立即安排下一轮，不增加固定一秒间隔；若 ImageReader 暂时没有新图则返回空并在 50ms 后重新申请，不上传空帧。同一时刻最多处理一帧。
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

- 屏幕共享确认：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/ProjectionActivity.kt`
- MediaProjection 前台服务：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/capture/ProjectionCaptureService.kt`
- VirtualDisplay 与 ImageReader：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/capture/ProjectionController.kt`
- 自动上线与首图：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt`
- 网络恢复与 WS 心跳：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/net/AgentSocket.kt`
- HTTP 自动上线与上传：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/net/HttpUploader.kt`
- 设备私有 Token：`android/apk-templates/b-packages/screenagent-1.7.2/app/src/main/java/com/zaka/screenagent/net/DeviceSession.kt`
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
