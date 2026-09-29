# 实时最新帧协议 · boundary-screenshot-v2

日期：2026-09-29。**已实现于 Node、Vue 和 B 包 `screenagent-1.7`。** 1.0–1.4 已删除，1.5/1.6 作为兼容模板保留。本协议负责无障碍开启后的自动上线、用户确认 MediaProjection 后的首图、查看租约有效期间的串行最新帧、六个固定快捷操作，以及显式提交到当前焦点输入框的文本。截图通道不接受坐标、手势、脚本、节点正文、音频或视频流；1.7 的结构预览由独立 `boundary-node-v2` 处理。

## 1. 取图时机

### 1.1 用户确认屏幕共享后的首图

1. 用户在 Android 系统设置显式开启与构建时 B 包 APP 名称相同的无障碍服务；构建器同时写入应用名称和无障碍服务名称。
2. B 包建立认证设备 WS，立即上报 `accessibilityAlive:true`，之后每 20 秒发送状态心跳；此时尚不读取屏幕。
3. 无障碍服务连接后，B 包 1.7 通过无自定义内容的内部 Activity 立即调用 `MediaProjectionManager.createScreenCaptureIntent()`，由 Android 系统显示本次共享确认。确认成功后启动 `mediaProjection` 类型前台服务，并在显示持续通知后调用 `getMediaProjection()`；B 包没有 MAIN/LAUNCHER 或业务页面。
4. 客户端先注册 `MediaProjection.Callback`，再创建一个 `VirtualDisplay` 和 `ImageReader.newInstance(..., maxImages=2)`；无障碍配置保持 `canTakeScreenshot=false`。
5. 设备申请 `{reason:"initial_accessibility"}` 的一次性上传许可；从 `ImageReader.acquireLatestImage()` 取得第一张非空帧并关闭 `Image`。JPEG 经解码、转正、去除元数据并重编码后，仅在有界内存保留最新一帧 5 分钟。

每个新的 MediaProjection 会话都重新取得系统确认；停止通知、系统投屏停止回调或服务销毁会释放 VirtualDisplay、ImageReader 和 MediaProjection。

### 1.2 后台实时查看

1. Vue 打开截图浮窗后，每 5 秒续一次 12 秒查看租约：

```json
{ "type": "capture_viewer_heartbeat", "sessionId": "DEVICE_ID", "data": { "viewerId": "UUID" } }
```

2. Node 保存租约并向设备下发：

```json
{
    "protocol": "boundary-screenshot-v2",
    "type": "command",
    "data": {
        "command": "SCREENSHOT_VIEWER_LEASE",
        "commandId": "VIEWER_UUID",
        "params": { "viewerId": "VIEWER_UUID", "validForMs": 12000 }
    }
}
```

3. Vue 只需发送一次启动指令：

```json
{
    "type": "command",
    "sessionId": "DEVICE_ID",
    "data": { "command": "SCREENSHOT_NOW", "commandId": "UUID", "params": { "viewerId": "UUID" } }
}
```

4. Node 校验面板订阅、账号、查看租约和在线设备，建立与 `commandId/viewerId` 绑定的待执行项，并将指令转发给设备。
5. B 包确认后，在查看租约持续有效时串行执行“申请一次性上传许可 → `acquireLatestImage()` → 缩放到最大 540px 宽 → JPEG 50 压缩 → 上传 → 下一帧”。同一设备始终只有一帧在截图、编码或上传，不积压旧帧。
6. 当前 `screenagent-1.7` 使用完成驱动的串行循环：一帧成功上传后立即申请并读取下一张最新帧，不加固定一秒间隔。`acquireLatestImage()` 暂时返回空时不上传，在 50ms 后重新走下一轮；实际刷新率由显示产帧、许可请求、JPEG 压缩、上传和服务端解码共同决定。
7. 每帧仍独立申请 60 秒一次性上传许可。HTTP 201 后 Node 用 `screenshot_ready` 通知订阅面板，Vue 立即读取鉴权的最新图片地址；新帧替换旧帧。

## 2. 固定快捷操作

截图浮窗在同一有效 `viewerId` 下可发送：

```json
{
    "type": "command",
    "sessionId": "DEVICE_ID",
    "data": {
        "command": "DEVICE_ACTION",
        "commandId": "UUID",
        "params": { "viewerId": "VIEWER_UUID", "action": "HOME" }
    }
}
```

`action` 只允许 `BACK | HOME | RECENTS | LOCK | WAKE | DND_TOGGLE`。Node 校验登录面板、设备订阅、有效查看租约、在线设备与枚举值后才转发；B 包再校验本地租约并只调用 Android 固定系统动作。锁屏需 Android 9 以上；点亮只唤醒屏幕，不解锁；勿扰需要用户预先在 Android 特殊权限中允许该 B 包，未允许时返回 `dnd_permission_required`。设备通过 `command_ack` 返回 `accepted|rejected` 和受限 `reasonCode`；Vue 只在收到设备结果后显示“勿扰已开启/已关闭”。

## 3. 焦点文本发送

截图与阅读器浮窗各自保留一行文本框，最多输入 500 个字符。用户点击「发送」后，Vue 在同一查看租约内发送：

```json
{
    "type": "command",
    "sessionId": "DEVICE_ID",
    "data": {
        "command": "TEXT_INPUT",
        "commandId": "UUID",
        "params": { "viewerId": "VIEWER_UUID", "text": "合成输入 123" }
    }
}
```

Node 校验登录面板、订阅、在线设备、文本长度和查看租约后转发；`command_dispatched`、设备回执与审计日志均不回显文本。B 包只在收到该指令时查找当前 `FOCUS_INPUT`，确认节点可编辑且不是密码字段，再调用 `ACTION_SET_TEXT`。无焦点、不可编辑、密码字段、空文本、超过 500 字符或租约失效都会拒绝，并仅返回固定 `reasonCode`。此指令不读取或上传输入框原有内容；节点预览仍只上传结构字段。

## 4. 停止条件

- 浮窗关闭、组件卸载或主动关闭：Vue 发送 `capture_viewer_close`，Node 撤销待执行项和上传许可，并向设备发送 `SCREENSHOT_VIEWER_CLOSE`。
- 浏览器刷新、关闭或面板 WS 断开：Node 执行相同清理。
- 页面无法续租但 TCP 暂未断开：设备侧租约在 12 秒后失效，不再开始下一帧。
- B 包在读取前、编码后、上传前和下一帧调度前检查当前 `viewerId` 租约；过期结果不会继续上传。MediaProjection 停止时也会中止查看命令。
- 新 `SCREENSHOT_NOW` 替换同设备旧的查看命令；设备没有查看租约时拒绝启动。

## 5. 上传许可

`POST /api/device/screenshot-session` 支持：

| reason                  | 必需字段                      | 签发条件                       |
| ----------------------- | ----------------------------- | ------------------------------ |
| `manual_user`           | `deviceId,consent:true`       | 手机设置页本次确认             |
| `initial_accessibility` | `deviceId`                    | 无障碍已开启且通过一分钟冷却   |
| `viewer_request`        | `deviceId,commandId,viewerId` | 与有效、持续续租的查看命令匹配 |

每个许可有效 60 秒且只能上传一次。图片通过设备 Bearer Token 保护的 `POST /api/device/screenshot` multipart 上传，不进入 16KiB WS。单帧最大 2MiB、400 万像素、最长边 4096px；最新帧缓存总量 16MiB，进程重启即清空。

## 6. 结果与边界

- 普通 `subscribe` 只订阅状态，不截图；只有首图或明确打开实时查看浮窗才调用截图 API。
- `command_ack:accepted` 仅表示设备开始受租约控制的循环；每个 `screenshot_ready` 才表示一张图片已由服务端接收并校验。
- `screenshot_result` 可在同一 `commandId` 下重复出现，分别报告各帧的 `uploaded|failed`。
- `reasonCode` 使用受限字符串，例如 `viewer_lease_expired`、`projection_permission_required`、`projection_frame_unavailable`、`upload_failed`，不透传异常正文。
- 安全窗口、锁屏或厂商系统限制仍可能导致截图失败。协议不上传无障碍节点正文；独立节点通道只保留类名、坐标、层级和布尔属性。系统不实现任意手势、按键序列或脚本执行；文本只写入用户当前已聚焦的非密码输入框。
