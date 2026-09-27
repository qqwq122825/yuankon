# 设备接口入口

当前后端为 Node；实际 HTTP / WebSocket 契约见 [NODE_PROTOCOL.md](NODE_PROTOCOL.md)。

已实现：本机独立设备 JWT、`/ws/device`（别名 `/ws/session`）状态上报、心跳和只读面板订阅。

另已实现 [ScreenAgent 首次登记与单张截图](SCREENAGENT_INGRESS.md)：构建页配置 APK ID 归属、生成登记码，设备使用 `/api/client/register` 取得独立 Token；`/api/device/screenshot-session` + `/api/device/screenshot` 接收手机主动发送的一张 JPEG，临时预览 5 分钟。

```bash
npm run device:token -- TEST_DEVICE_001
```

CLI 凭证写入 `backend/.node-private/device-credentials/`，控制台只显示路径；此旧路径仅用于状态联调，不代替截图接入登记。面板与设备凭证隔离，设备主体和项目归属由服务端验证。新接入副本源码已对接；原 android-shell 不变。测试状态不等于真实手机在线。

原 PHP v1 诊断会话、网页租约、临时图像/结构帧接口已随旧后端移除，Node 尚未实现，当前返回 404。客户端可见会话、暂停/停止、失效停止等后续约束保留于 [APK_BASE_DESIGN.md](APK_BASE_DESIGN.md) 第 8 节，不能将只读订阅视为开始采集。

2026-09-28 截图链路按 [boundary-screen-v1 设计稿](SCREEN_CAPTURE_PROTOCOL.md) 收敛：显式查看会话、手机确认、MediaProjection、HTTPS JPEG 帧、WS 元信息通知、10 秒租约。该文包含与开放版规范和 ScreenAgent 的差异、待新增端点与验收条件；不是已上线接口。
