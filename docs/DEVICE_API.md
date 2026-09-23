# 设备诊断 API · 服务端联调版 v1

## 实现状态

已实现 PHP 接口、数据库迁移、测试与桌面查看器连接入口；**APK 尚未调用这些接口**。当前没有真机上线，也没有部署到公开域名。参考截图和合成测试帧不代表实际设备结果。

管理页面继续只接受本机请求。手机端诊断设计为用户主动开始、持续可见提示和停止入口；服务端会话和网页租约分别验证。服务开启状态只属于心跳字段，不自动创建采集会话。

## 本地启动与凭证

```bash
# 使用 PHP 8.3+，保留已有 APP_KEY
composer install
php artisan migrate
php artisan devices:issue-token "登记的测试设备"
php artisan schedule:work
```

命令把独立 Sanctum 令牌写入 `storage/app/private/device-credentials/API-*.json`，文件权限 0600。它不在控制台打印令牌正文。每个安装实例独立登记；有效期 30 天、能力 `diagnostics:write`，数据库仅存令牌摘要。凭证交付/手机登记 UI 待实现，APK 中没有共享万能令牌。撤销令牌使用 Sanctum 的 token 删除机制，正式管理 UI 待补齐。

默认 `DIAGNOSTICS_REMOTE_API=false`，只接受本机直接访问。显式配置 true 后，设备 API 要求 HTTPS 和独立设备令牌；该配置不开放管理页面。上线前还需反向代理边界、认证/项目成员权限、访问审计和容量验收；当前不向宝塔或 Cloudflare 自动部署。

所有设备请求：

```
Authorization: Bearer DEVICE_TOKEN
Accept: application/json
```

不接受客户端指定 project_id 或 device_id 改写归属。JSON 和 multipart 都按字段白名单构造持久化对象；请求日志与代理日志均应避免记录 Authorization 或请求正文。

## 1. 心跳

`POST /api/v1/device/heartbeat`，JSON：

```json
{"schema_version":1,"sequence":1,"accessibility_enabled":true,"battery":86}
```

回应示意：

```json
{"accepted_sequence":1,"server_time":"2026-09-19T06:00:00+00:00","heartbeat_interval_ms":1000}
```

建议客户端目标间隔 1 秒；后台在线依据服务器最近 15 秒收到的有效心跳。sequence 为安装实例持久化递增正整数，旧序号不刷新在线时间；最大值 2^53−1。访问失败应退避，401/403 停止，429 遵循 Retry-After。心跳绝不续诊断网页租约。设备列表需刷新以获取当前在线状态，尚非实时推送列表。

## 2. 用户发起的会话

`POST /api/v1/diagnostics/sessions`：

```json
{"session_id":"客户端生成的 UUID","consent_version":"visible-diagnostics-v1","duration_seconds":120}
```

duration_seconds 为 10–900。同一设备仅一个未结束会话；同 ID 重试幂等。初始 waiting，最多等待网页 30 秒，此时 `capture_allowed=false`。客户端声明用途版本不等同于后端独立验证了手机提示，提示与停止行为仍必须实机验收。

- `GET /api/v1/diagnostics/{id}`：读取当前状态。
- `POST /api/v1/diagnostics/{id}/stop`：停止本设备会话，可重试。

状态包含 `session_id/status/capture_allowed/lease_remaining_ms/last_sequence/snapshot_id/expires_at`。状态仅 waiting → active → stopped/expired；结束后重新开始需新 ID，不自动恢复。

## 3. 网页查看租约（本机管理页、CSRF 保护）

- `GET /devices/{id}/diagnostics`：最新会话与在线信息。
- `POST /devices/{id}/diagnostics/{sessionId}/lease`：`{"viewer_id":"本页随机 UUID"}`，领取或续租 10 秒，受最长会话时间约束。另一页面领取返回 409，不接管已有查看者。
- `GET /devices/{id}/diagnostics/{sessionId}/preview`：当前帧结构与私有图片地址。
- `POST /devices/{id}/diagnostics/{sessionId}/stop`：结束会话。

桌面页点击「连接已开启的诊断」后每秒拉取预览、约每 3 秒续租。离开/隐藏页面或关闭全部浮窗停止本页会话。关闭页面请求只是尽力发送；网络中断仍由租约兜底。网页只连接客户端已创建的会话，没有远程启动 APK/截屏命令。

客户端后续应使用本地单调时钟计算租约剩余期限；连续状态查询失败、页面租约到期或用户停止时，立即释放采样资源。服务端即使仍收到心跳，也会拒收过期帧。UI 后台计时器节流可导致提前过期，这是停止优先的预期行为。

## 4. 帧接收

`POST /api/v1/diagnostics/{id}/frames`，`multipart/form-data`：

| 字段 | 规则 |
| --- | --- |
| sequence | 会话内递增整数，1 到 2^53−1；重复/旧帧 accepted=false |
| snapshot | JSON 字符串，最大 524,288 字符；遵循 SNAPSHOT_PROTOCOL.md 的 v1 结构白名单 |
| screenshot | 可选二进制图片，PNG/JPEG/WebP，≤2MB，宽高各≤2560px；校验并重新编码 PNG |

总请求入口限制约 3MB，Web 服务器/PHP 也需配置独立 body 限额。图片使用 multipart 二进制，不采用 base64。节点接口复用既有结构/树深度/节点数/循环/合成事件校验，原始节点 text 与敏感输入正文从对象中剔除；图片中的内容不会自动 OCR 或脱敏，因此只使用预设测试画面。

每个会话仅保留最新一帧，替换时删除上一张私有图片。结束或过期删除临时快照及图片；页面、图片和 JSON 访问均检查项目及会话状态。`diagnostics:prune` 每分钟清理无后续请求的到期会话，逻辑到期即时生效，物理删除可能晚约一分钟。磁盘故障、崩溃遗留的孤立文件清理及告警仍待完善。

回应包含 accepted、服务端 last_sequence 和会话状态，手机只清理已确认的数据，不在失败时积累无界队列。

## 5. 保护与容量

- Sanctum 限定设备身份、令牌能力和有效期；项目归属从服务端设备记录确定。
- 粗粒度每 IP 600 次/分钟；心跳每设备 90 次/分钟、帧每设备 65 次/分钟、会话开启每 IP 10 次/分钟。当前是小规模联调限制，不是上万设备配置。
- 401 令牌无效/到期，403 访问边界或能力不符，404 会话不属于设备/项目，409 已结束/冲突，413 过大，422 数据校验失败，429 限流。
- 只读预览不含任意命令、远程输入、文件浏览或脚本执行接口。
- 接口测试覆盖跨设备/项目、过期令牌、正文剔除、旧帧、租约超时、非法图像和本机限制。

后续工作：客户端可见会话、独立凭证接入、真实采样/停止测试、管理登录与多租户审计、MySQL 与实际容量验证。
