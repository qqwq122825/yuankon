# 设备接口入口

当前后端为 Node；实际 HTTP / WebSocket 契约见 [NODE_PROTOCOL.md](NODE_PROTOCOL.md)。

已实现：本机独立设备 JWT、`/ws/device`（别名 `/ws/session`）状态上报、心跳和只读面板订阅。

另已实现 [ScreenAgent 首次登记与实时最新帧](SCREENAGENT_INGRESS.md)：构建页配置 APK ID 归属、生成登记码，设备使用 `/api/client/register` 取得独立 Token；无障碍开启后上传一张列表临时缩略图，网页点击实时查看后通过 [boundary-screenshot-v2](SCREENSHOT_COMMAND_PROTOCOL.md) 下发一次 `SCREENSHOT_NOW`，B 包在 12 秒续租期间串行更新最新帧。图片由 `/api/device/screenshot-session` + `/api/device/screenshot` 接收并暂存 5 分钟。

```bash
npm run device:token -- TEST_DEVICE_001
```

CLI 凭证写入 `backend/.node-private/device-credentials/`，控制台只显示路径；此旧路径仅用于状态联调，不代替截图接入登记。面板与设备凭证隔离，设备主体和项目归属由服务端验证。新接入副本源码已对接；原 android-shell 不变。测试状态不等于真实手机在线。

原 PHP v1 连续诊断会话和结构帧接口已随旧后端移除。Node 现实现最新帧的 12 秒查看租约；普通 `subscribe` 仍不开始采集。独立暂停/恢复/质量设置仍保留于 [APK_BASE_DESIGN.md](APK_BASE_DESIGN.md) 第 8 节。

完整截图会话仍按 [boundary-screen-v1 设计稿](SCREEN_CAPTURE_PROTOCOL.md) 收敛，该文不是已上线接口。当前已上线的首图、实时最新帧、心跳和关闭行为以 [boundary-screenshot-v2](SCREENSHOT_COMMAND_PROTOCOL.md) 为准。
