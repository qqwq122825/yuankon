# ScreenAgent 首次登记与实时最新帧接入

2026-09-28：已完成 **设备归属 + 无障碍开启首图 + 网页租约内实时最新帧**。已上线的消息、12 秒查看租约、Android 版本调度间隔和关闭语义见 [boundary-screenshot-v2](SCREENSHOT_COMMAND_PROTOCOL.md)。带暂停/恢复、质量切换和历史帧的完整诊断会话仍按 [截图会话设计](SCREEN_CAPTURE_PROTOCOL.md) 留待后续。

## 现在怎么用

1. 启动本机 Node，登录超管。账号创建时已有固定 APK ID，在顶栏或账号设置查看，不手动创建归属。
2. 从网页构建 APK：编号可选；留空或未匹配可用账号时使用默认接收账号（当前为超管）。构建记录显示最终写入 APK 的实际编号；总台/子账号尚未加入。
3. 进入「账号设置 → 设备接入调试」，选构建记录中的实际 APK ID，生成 10 分钟设备登记码。一个码登记一台设备；短效码只在生成时返回，不保存到网页 localStorage 或日志。
4. 使用 `android-screenagent` 的接入版 APK，在手机填 **后台 origin** 和登记码，点「登记设备」。首页网址不再用于上报。
5. 手机登记成功得到独立设备 Token；WS 使用该 Token 上线，后台列表展示设备。详情的「APK ID / 归属」显示真实服务端分配。
6. 手机打开系统无障碍设置并启用「Boundary 只读截图」。Android 11+ 自动取一帧作为列表临时缩略图；服务不读取窗口正文。Android 10 及以下可使用设置页的 MediaProjection 兼容单次按钮。
7. 网页打开设备详情，点击圆形「开始」或右侧「实时查看截图」。页面每 5 秒续 12 秒查看租约，Node 下发一次 `SCREENSHOT_NOW`；`screenagent-1.2` 随后按 Android 11 1001ms、Android 12+ 334ms 的最短安全调度间隔串行上传最新帧。浮窗/网页关闭、WS 断线或租约失效均停止循环。最新图最多暂存 5 分钟，新图替换旧图。

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
创建账号：自动分配固定 APK ID → project_id + owner_account_id
构建解析：有效账号编号 → 指定归属；空/未匹配 → 默认账号编号写入 APK
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
| 超管 | `POST /api/device-enrollments` | `{apkId}` → `{enrollmentId,enrollmentToken,expiresAt}`；10 分钟 |
| 登记码 | `POST /api/client/register` | 下面的原 ScreenAgent 设备画像 → 设备凭证与归属 |
| 设备 | `POST /api/sync/status` | `{deviceId,apkId?,batteryLevel?,accessibilityAlive?,...}`；仅白名单状态更新 |
| 设备 | `POST /api/device/screenshot-session` | `manual_user / initial_accessibility / viewer_request` 三种严格原因 → 60 秒一次性许可 |
| 设备 | `POST /api/device/screenshot` | 原 multipart 字段 + `X-Capture-Upload: uploadId`；接收成功后返回 201 |
| 超管 | `GET /api/devices/:id/ownership` | `id` 为数值设备记录 ID，返回 APK ID 和归属账号 |
| 超管 | `GET /api/devices/:id/screenshot` | `{frame,mode:"leased-latest-frame",retentionSeconds:300}`；无图 frame 为 null |
| 超管 | `GET /api/devices/:id/screenshot/:frameId` | 校验当前登录态后读取临时 JPEG；替换/过期返回 410 |
| 超管 | `POST /api/devices/:id/revoke` | `{}` 撤销本阶段登记的设备凭证并清理图片/上传许可；旧 CLI 设备不适用 |

登记请求沿用现有字段：

```json
{
  "deviceId": "TEST_SCREEN_DEVICE",
  "apkId": "1",
  "brand": "Synthetic",
  "model": "Test device",
  "osVersion": "14",
  "appVersion": "1.1.0",
  "appName": "ScreenAgent",
  "batch": "",
  "buildId": "test-build",
  "packageName": "com.zaka.screenagent"
}
```

返回 `{deviceId,localId,apkId,owner:{id,username},deviceToken,expiresAt}`。设备 Token 有效期 7 天，含独立凭证 ID；服务端逐次比对凭证记录、撤销状态及所有者启用状态。APK 端保存于禁止备份的应用私有存储；后续轮换尚未实现。

图片 multipart 保留 `deviceId/apkId/batch/buildId/ts/file`。`ts` 为采样端毫秒时间，仅作报告；服务端 `receivedAt` 才是接收时间。图片文件名忽略，单幅 JPEG 最大 2MiB、最多 400 万像素、最长边 4096px；真实解码并剥除元数据后重新编码。新增请求头 `X-Capture-Upload` 绑定一次性上传许可，旧许可、换设备、改归属、撤销、过期或重复使用都失败。

成功响应为 `{frameId,receivedAt,capturedAt,expiresAt,width,height,imageUrl,reason,commandId,viewerId}`。只有完成校验且写入临时缓存后才返回成功，不把 WS 回执当成图片上传成功。列表仅把仍在 5 分钟有效期内的图片作为临时缩略图。

WS 仍使用 `/ws/device` 和 Bearer 设备凭证。登记设备兼容 `register`、`device_ping`、`status/data.type=device_status`，并实现 `boundary-screenshot-v2` 的 `SCREENSHOT_VIEWER_LEASE / SCREENSHOT_NOW / SCREENSHOT_VIEWER_CLOSE`、`command_ack` 与逐帧 `screenshot_result`；Node 继续接受 1.1 B 包的 v1 回执。原 `screenshot` 元信息不作为图片帧接收；没有启用输入或其他远程操作。

## 数据、限额与兼容

- SQLite 新增 `apk_routes/device_enrollments/device_credentials`；devices 新增 APK ID、归属账户列；事务迁移，不重建旧设备或旧快照。
- 每帧上传许可仅内存保存且成功接收后消费；查看命令由 5 秒心跳延续，关闭或 12 秒租约失效时撤销。临时图片也仅在内存，进程重启即清空。
- 全局最多 64 个有效上传许可、2 个在途上传/解码任务；单请求 10 秒；临时编码图总量最多 16MiB。超限返回 429；该限制不是整个进程的内存上限。
- 无图片永久归档、无 Base64 入库、无 multipart/Token 正文审计；只记录登记、许可签发、接收/撤销等白名单元数据。
- 首次上线归属和设备截图均走专用接口，未恢复手动导入页面或任意文件上传接口。
- 后台拉黑/删除会立即清理该设备临时图片与上传许可并关闭连接；登记重试、状态上报与截图接口均重新检查禁用状态。取消拉黑后凭有效 Token 重新连接，需重新申请单次上传许可；删除同时撤销凭证，保留历史记录用于审计。
- 错误：401 凭证无效，403 身份字段冲突，404 路由/配置不存在，409 重复归属/冲突登记，410 截图许可或图片失效，413 文件过大，415 类型不符，422 字段/图片校验失败，429 达到限额。

## APK 源码与构建

- `screenagent-1.2` 是当前 B 包工作端，只写入后台域名，不保存首页，也不声明桌面 MAIN/LAUNCHER；系统安装完成页只提供“完成”。A 包安装器通过显式包名和 `org.boundarylab.screenagent.SETUP` 打开设置页。无障碍服务声明截图能力，但 `canRetrieveWindowContent=false`，事件回调为空。`screenagent-1.1` 保留按需单张行为，`screenagent-1.0` 保留旧手动单次行为。
- `installer-1.0` 是 A 包桌面安装器，单独写入 HTTPS 首页。Node 只从同一归属账号的成功 B 包产物复制 `payload.apk`，固定写入构建 ID/摘要/包名；手机端再次校验摘要后调用系统安装器，不使用静默安装。
- `android/apk-templates/b-packages/screenagent-1.2/`：当前 B 包接入源码；以后截图、无障碍视图等工作能力均通过新增 B 包版本演进。
- `android/apk-templates/standalone/browser-1.0/` 保留为独立浏览器模板。
- `CaptureController.kt` 与附件同文件 SHA-256 一致：`58a0838b79f384f60403abacb08553415b3911f163416b8126beed5bd858739a`。
- 外围调整：后端地址与 Token、登记 UI、无障碍设置入口、设备 WS 心跳、首图与租约实时查看回执；MediaProjection 兼容入口仍有通知和停止按钮。本接入副本没有开机采集入口，不使用 START_STICKY；实时最新帧只在查看租约有效时运行。
- 使用本项目已安装的 API 35 / AGP 8.9.2 / Gradle 8.11.1 工具链编译，APK targetSdk 仍为 34；Kotlin 为原 1.9.22。原浏览器构建命令不变。

```bash
npm run build:screenagent
# 首次依赖缓存未准备时才允许 Gradle 下载到项目私有缓存：
SCREENAGENT_GRADLE_ONLINE=1 npm run build:screenagent
```

脚本复制固定源码到 `android/dist/screenagent-*/source`，编译、Lint、签名校验、对齐校验后输出 `screenagent.apk`。独立 CLI 的模板默认 APK ID 为当前超管编号 `1`，不经过 Node 归属解析；实际接入应优先使用网页构建，它会写入真实账号编号。登记码不打包进 APK。

## 验证范围

Node 测试覆盖首次/重试/并发登记、身份混用、设备标识伪造、WS 心跳、首图限频、查看租约续期、同一命令连续多帧许可、关闭、真实 JPEG 解码与读回、非法格式/像素/大小、跨设备许可、撤销及到期。浏览器测试使用生成的纯色 JPEG，验证列表缩略图、设备归属、实时查看浮窗和窄窗口布局；该图片不是手机截图。

真机需另验：系统无障碍启停、Android 11+ `takeScreenshot`、安全窗口失败、USB 本机登记、网页直接关闭后的 12 秒失效、Android 10 兼容按钮及旋转/断网/锁屏清理。当前没有真机运行结果。

### 本次本地验证记录

- `npm run check`：格式、前端编译、71 项 Node 测试通过。
- `npm run test:e2e`：14 项 Chromium 测试通过；图片验证使用生成的合成 JPEG。
- `npm run build:screenagent`：`screenagent-1.2` Gradle 编译、Lint、开发签名与 zipalign 通过，确认 `versionName=1.2.0`、`versionCode=3` 且无桌面入口。
- APK：`android/dist/screenagent-kytMC6/screenagent.apk`；3,748,854 字节；SHA-256 `fe4064e1ec415bbc74d58f0f3e4e5b9f9ddbe77c2d6a54dc50a8ed2717bcfb83`。
- 本机 SQLite 升级前已在线备份；已验证带旧快照外键的原地加列迁移，旧 6 台设备、5 条快照保留，`foreign_key_check` 为 0 条错误。
- 本机服务已在 `127.0.0.1:8080` 启动且健康检查返回 200；ADB 没有连接设备，因此未安装 APK，真实 Android 11/12+ 帧率与厂商差异仍需真机验收。未创建提交、推送或做外部部署。
