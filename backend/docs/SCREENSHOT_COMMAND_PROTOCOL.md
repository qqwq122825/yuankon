# 实时最新帧协议 · boundary-screenshot-v2

日期：2026-09-28。**已实现于 Node、Vue 和 B 包 `screenagent-1.3`。** `screenagent-1.2` 保留旧登记行为；Node 兼容旧包。本协议负责无障碍开启后的自动上线与首图，以及后台查看租约有效期间的串行最新帧循环；不包含输入控制、节点正文、音频或视频流。

## 1. 取图时机

### 1.1 无障碍开启后的首图

1. 用户在 Android 系统设置显式开启 `Boundary 只读截图` 无障碍服务。
2. B 包建立认证设备 WS，立即上报 `accessibilityAlive:true`，之后每 20 秒发送状态心跳。
3. Android 11（API 30）及以上使用 `AccessibilityService.takeScreenshot` 获取一帧；服务声明 `canTakeScreenshot=true`，保持 `canRetrieveWindowContent=false`。
4. 设备申请 `{reason:"initial_accessibility"}` 的一次性上传许可；Node 在无障碍状态已同步后签发，同设备一分钟内最多一次。
5. JPEG 经真实解码、转正、去除元数据并重编码后，仅在有界内存保留最新一帧 5 分钟。

Android 10 及以下不支持该 API，可继续使用设置页的 MediaProjection 手动单次兼容入口。

### 1.2 后台实时查看

1. Vue 打开截图浮窗后，每 5 秒续一次 12 秒查看租约：

```json
{"type":"capture_viewer_heartbeat","sessionId":"DEVICE_ID","data":{"viewerId":"UUID"}}
```

2. Node 保存租约并向设备下发：

```json
{"protocol":"boundary-screenshot-v2","type":"command","data":{"command":"SCREENSHOT_VIEWER_LEASE","commandId":"VIEWER_UUID","params":{"viewerId":"VIEWER_UUID","validForMs":12000}}}
```

3. Vue 只需发送一次启动指令：

```json
{"type":"command","sessionId":"DEVICE_ID","data":{"command":"SCREENSHOT_NOW","commandId":"UUID","params":{"viewerId":"UUID"}}}
```

4. Node 校验面板订阅、账号、查看租约和在线设备，建立与 `commandId/viewerId` 绑定的待执行项，并将指令转发给设备。
5. B 包确认后，在查看租约持续有效时串行执行“申请一次性上传许可 → `takeScreenshot` → JPEG 压缩 → 上传 → 下一帧”。同一设备始终只有一帧在截图、编码或上传，不积压旧帧。
6. Android 11 使用 **1001ms** 最短调度间隔；Android 12 及以上使用 **334ms**。间隔从上次调用 `takeScreenshot` 计时，并为 AOSP 的 1000ms/333ms 限制留 1ms 边界。实际刷新率还受截图、JPEG 压缩、网络和服务端解码耗时限制。
7. 每帧仍独立申请 60 秒一次性上传许可。HTTP 201 后 Node 用 `screenshot_ready` 通知订阅面板，Vue 立即读取鉴权的最新图片地址；新帧替换旧帧。

## 2. 停止条件

- 浮窗关闭、组件卸载或主动关闭：Vue 发送 `capture_viewer_close`，Node 撤销待执行项和上传许可，并向设备发送 `SCREENSHOT_VIEWER_CLOSE`。
- 浏览器刷新、关闭或面板 WS 断开：Node 执行相同清理。
- 页面无法续租但 TCP 暂未断开：设备侧租约在 12 秒后失效，不再开始下一帧。
- B 包在截图前、编码后、上传前和下一帧调度前检查当前 `viewerId` 租约；过期结果不会继续上传。
- 新 `SCREENSHOT_NOW` 替换同设备旧的查看命令；设备没有查看租约时拒绝启动。

## 3. 上传许可

`POST /api/device/screenshot-session` 支持：

| reason | 必需字段 | 签发条件 |
|---|---|---|
| `manual_user` | `deviceId,consent:true` | 手机设置页本次确认 |
| `initial_accessibility` | `deviceId` | 无障碍已开启且通过一分钟冷却 |
| `viewer_request` | `deviceId,commandId,viewerId` | 与有效、持续续租的查看命令匹配 |

每个许可有效 60 秒且只能上传一次。图片通过设备 Bearer Token 保护的 `POST /api/device/screenshot` multipart 上传，不进入 16KiB WS。单帧最大 2MiB、400 万像素、最长边 4096px；最新帧缓存总量 16MiB，进程重启即清空。

## 4. 结果与边界

- 普通 `subscribe` 只订阅状态，不截图；只有首图或明确打开实时查看浮窗才调用截图 API。
- `command_ack:accepted` 仅表示设备开始受租约控制的循环；每个 `screenshot_ready` 才表示一张图片已由服务端接收并校验。
- `screenshot_result` 可在同一 `commandId` 下重复出现，分别报告各帧的 `uploaded|failed`。
- `reasonCode` 使用受限字符串，例如 `viewer_lease_expired`、`android_version_unsupported`、`screenshot_error_3`、`upload_failed`，不透传异常正文。
- 安全窗口、锁屏或厂商系统限制仍可能导致截图失败。协议不读取无障碍节点正文，也不实现手势、按键或输入。
