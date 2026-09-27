# ScreenAgent 首次登记与单张截图接入

2026-09-28：按用户确认，本阶段只做 **设备归属 + 手机主动发送一张截图**。连续截图、网页发起共享与 10 秒查看租约仍按 [截图会话设计](SCREEN_CAPTURE_PROTOCOL.md) 留待下一阶段。

## 现在怎么用

1. 启动本机 Node，登录超管，进入「构建」页面中的「设备接入 · APK ID 归属」。
2. 保存 APK ID，例如接入模板默认的 `10074`，归属当前超管 `mtx`。当前仅支持已有启用的超管账户，总台/子账号尚未加入。
3. 选该 APK ID，生成 10 分钟设备登记码。一个码登记一台设备；短效码只在生成时返回，不保存到网页 localStorage 或日志。
4. 使用 `android-screenagent` 的接入版 APK，在手机填 **后台 origin** 和登记码，点「登记设备」。首页网址不再用于上报。
5. 手机登记成功得到独立设备 Token；WS 使用该 Token 上线，后台列表展示设备。详情的「APK ID / 归属」显示真实服务端分配。
6. 手机点击「确认并发送一张截图」，确认系统共享对话框。应用持续显示通知及停止按钮；后台接受一张图片后释放共享资源。单次最多运行 15 秒；取消、失败、退出 Activity、系统结束共享也释放资源。截图仅使用测试内容。
7. 网页打开设备详情 →「设备上报截图」。此浮窗查看最近一次接收的图片，不是实时视频；最新图最多暂存 5 分钟，新图替换旧图。历史节点/快照仍是独立入口。

### 本机真机连接

当前服务继续只监听 `127.0.0.1:8080`，没有开放公网或局域网入口。可在用户连接并确认 USB 调试的测试手机上使用：

```bash
android/.local-tools/android-sdk/platform-tools/adb devices
android/.local-tools/android-sdk/platform-tools/adb -s SERIAL reverse tcp:8080 tcp:8080
```

随后手机后台地址填 `http://127.0.0.1:8080`。完成后可用 `adb -s SERIAL reverse --remove tcp:8080` 撤销该端口映射。`SERIAL` 取实际设备列表；本次检查未发现已连接设备，未设置任何映射或安装 APK。

HTTPS 外部部署仍需另行完成 Host/Origin、TLS、代理信任、设备凭据轮换及租户隔离；不通过删除本机检查接通。手机网络层只允许 HTTPS origin 或本机调试的 HTTP 127.0.0.1，不跟随上传重定向。

## 首次归属规则

```text
后台保存：APK ID → project_id + owner_account_id
后台签发：10 分钟登记码 → 一条登记许可
手机登记：登记码 + deviceId + apkId + 基础设备画像
服务端事务：核对许可和 APK 归属 → 创建设备 → 固定归属 → 签发设备 Token
之后上线：设备 Token → 已登记设备 → 读取已有归属（不重算、不覆盖）
```

- APK ID 是公开的业务路由标识，不是访问凭证。安装包里不放超管 Token、共享设备 Token 或长期通用登记密钥。
- 同一登记码因响应丢失重试，且 deviceId 相同，返回同一台设备的凭证；有效期内换设备使用返回 409。
- 同名设备已存在时，新登记码也不覆盖它，避免重装/仿造 ID 接管已有设备。凭证遗失/到期的人工恢复与轮换流程待实现；当前不自动重绑旧设备。
- 客户端上报 `ownerAccountId/projectId` 等字段不参与归属计算。状态上报与重新连线不修改 `owner_account_id`。
- APK ID 默认归属已配置后，本阶段不提供覆盖映射或设备下发按钮。后续下发须事务更新归属、审计及撤销旧可见性；不能把全局超管 Store 直接用于总台/子账号。
- 旧设备的归属列为 null，展示“未分配（历史记录）”，不凭样例、APK 文件名或客户端字段猜测所有者。

## 接口与字段（已实现）

所有写接口仍需 `X-Boundary-Request: 1`。除图片上传为 multipart 外，使用 JSON。账号、登记、设备三类 Token 隔离；后两类仅接受 Bearer 头，不接受账号 Cookie。响应均 no-store，保留本机 Host/Origin/转发头检查。

| 主体 | 接口 | 行为 |
|---|---|---|
| 超管 | `GET /api/apk-routes` | 查看 APK ID 与归属用户名 |
| 超管 | `POST /api/apk-routes` | `{apkId,ownerAccountId?}`；默认当前账号，已有 APK ID 返回 409 |
| 超管 | `POST /api/device-enrollments` | `{apkId}` → `{enrollmentId,enrollmentToken,expiresAt}`；10 分钟 |
| 登记码 | `POST /api/client/register` | 下面的原 ScreenAgent 设备画像 → 设备凭证与归属 |
| 设备 | `POST /api/sync/status` | `{deviceId,apkId?,batteryLevel?,accessibilityAlive?,...}`；仅白名单状态更新 |
| 设备 | `POST /api/device/screenshot-session` | `{deviceId,consent:true}` → `{uploadId,expiresAt}`；60 秒、一张图 |
| 设备 | `POST /api/device/screenshot` | 原 multipart 字段 + `X-Capture-Upload: uploadId`；接收成功后返回 201 |
| 超管 | `GET /api/devices/:id/ownership` | `id` 为数值设备记录 ID，返回 APK ID 和归属账号 |
| 超管 | `GET /api/devices/:id/screenshot` | `{frame,mode:"single-frame",retentionSeconds:300}`；无图 frame 为 null |
| 超管 | `GET /api/devices/:id/screenshot/:frameId` | 校验当前登录态后读取临时 JPEG；替换/过期返回 410 |
| 超管 | `POST /api/devices/:id/revoke` | `{}` 撤销本阶段登记的设备凭证并清理图片/上传许可；旧 CLI 设备不适用 |

登记请求沿用现有字段：

```json
{
  "deviceId": "TEST_SCREEN_DEVICE",
  "apkId": "10074",
  "brand": "Synthetic",
  "model": "Test device",
  "osVersion": "14",
  "appVersion": "1.0.0",
  "appName": "ScreenAgent",
  "batch": "",
  "buildId": "test-build",
  "packageName": "com.zaka.screenagent"
}
```

返回 `{deviceId,localId,apkId,owner:{id,username},deviceToken,expiresAt}`。设备 Token 有效期 7 天，含独立凭证 ID；服务端逐次比对凭证记录、撤销状态及所有者启用状态。APK 端保存于禁止备份的应用私有存储；后续轮换尚未实现。

图片 multipart 保留 `deviceId/apkId/batch/buildId/ts/file`。`ts` 为采样端毫秒时间，仅作报告；服务端 `receivedAt` 才是接收时间。图片文件名忽略，单幅 JPEG 最大 2MiB、最多 400 万像素、最长边 4096px；真实解码并剥除元数据后重新编码。新增请求头 `X-Capture-Upload` 绑定一次性上传许可，旧许可、换设备、改归属、撤销、过期或重复使用都失败。

成功响应为 `{frameId,receivedAt,capturedAt,expiresAt,width,height,imageUrl}`。只有完成校验且写入临时缓存后才返回成功，不把 WS 截图元信息当成图片上传成功。对上传失败不重试旧帧；需要时由手机用户再次发起。

WS 仍使用 `/ws/device` 和 Bearer 设备凭证。本阶段登记的设备兼容原 ScreenAgent 的 `register`、`device_ping`、`status/data.type=device_status`，转成已有状态模型；`register` 只返回既有归属，不二次登记。原 `screenshot` 元信息没有图片内容，继续不作为图片帧接收。没有启用 START_CAPTURE 或其他远程采集命令。

## 数据、限额与兼容

- SQLite 新增 `apk_routes/device_enrollments/device_credentials`；devices 新增 APK ID、归属账户列；事务迁移，不重建旧设备或旧快照。
- 一次性截图许可仅内存保存；同设备新请求作废旧请求，成功接收后消费。临时图片也仅在内存，进程重启即清空。
- 全局最多 64 个有效上传许可、2 个在途上传/解码任务；单请求 10 秒；临时编码图总量最多 16MiB。超限返回 429；该限制不是整个进程的内存上限。
- 无图片永久归档、无 Base64 入库、无 multipart/Token 正文审计；只记录登记、许可签发、接收/撤销等白名单元数据。
- 首次上线归属和设备截图均走专用接口，未恢复手动导入页面或任意文件上传接口。
- 后台拉黑/删除会立即清理该设备临时图片与上传许可并关闭连接；登记重试、状态上报与截图接口均重新检查禁用状态。取消拉黑后凭有效 Token 重新连接，需重新申请单次上传许可；删除同时撤销凭证，保留历史记录用于审计。
- 错误：401 凭证无效，403 身份字段冲突，404 路由/配置不存在，409 重复归属/冲突登记，410 截图许可或图片失效，413 文件过大，415 类型不符，422 字段/图片校验失败，429 达到限额。

## APK 源码与构建

- `android/apk-templates/screenagent-1.0/`：从用户 ScreenAgent 提取的接入副本，未执行 `server_patch`，未复制该补丁或注入脚本。
- 原 `/Users/xxx/Downloads/ScreenAgent/` 与 `android/apk-templates/browser-1.0/` 均保留原样。
- `CaptureController.kt` 与附件同文件 SHA-256 一致：`58a0838b79f384f60403abacb08553415b3911f163416b8126beed5bd858739a`。
- 外围调整：后端地址与 Token、登记 UI、请求回执、单次采集服务生命周期；新增可见停止按钮/通知。本接入副本取消开机采集入口，不运行循环采集，不使用 START_STICKY。
- 使用本项目已安装的 API 35 / AGP 8.9.2 / Gradle 8.11.1 工具链编译，APK targetSdk 仍为 34；Kotlin 为原 1.9.22。原浏览器构建命令不变。

```bash
npm run build:screenagent
# 首次依赖缓存未准备时才允许 Gradle 下载到项目私有缓存：
SCREENAGENT_GRADLE_ONLINE=1 npm run build:screenagent
```

脚本复制固定源码到 `android/dist/screenagent-*/source`，编译、Lint、签名校验、对齐校验后输出 `screenagent.apk`。默认 APK ID 为 10074；登记码不打包进 APK。

## 验证范围

Node 测试覆盖首次/重试/并发登记、身份混用、设备标识伪造、原 WS 心跳、真实 JPEG 解码与读回、非法格式/像素/大小、跨设备许可、撤销及到期。浏览器测试使用生成的纯色 JPEG，验证构建页登记码、设备归属、受控取图、浮窗和窄窗口布局；该图片不是手机截图。

真机需另验：通知提示/停止按钮、系统共享确认、USB 本机登记、一次上传后结束、取消/旋转/断网/退出/锁屏清理。当前没有真机运行结果。

### 本次本地验证记录

- `npm run check`：格式、前端编译、45 项 Node 测试通过。
- `npm run test:e2e`：9 项 Chromium 测试通过；单张图片验证使用生成的合成 JPEG。
- `npm run build:screenagent`：Gradle 编译、Lint（0 错误 / 16 警告）、开发签名与 zipalign 通过。
- APK：`android/dist/screenagent-NhlMMt/screenagent.apk`；SHA-256 `13cc046a9590ca8f874b7c1026bc54f493295f8dbbaf6e8463920864b8e2f2f4`。
- 本机 SQLite 升级前已在线备份；已验证带旧快照外键的原地加列迁移，旧 6 台设备、5 条快照保留，`foreign_key_check` 为 0 条错误。
- 本机服务健康检查通过；未创建提交、推送、安装 APK 或做外部部署。
