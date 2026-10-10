# 设备详情 UI 预览 API

本接口仅为详情页面提供固定分区、工具目录及明确的未接入状态，不新增设备能力或保存数据。现有详情、截图、节点阅读器与已接入操作仍使用各自原接口。

## 访问与验证

- 复用当前本机同源检查、登录认证与 `Store.withScope`。超管可访问既有授权范围，总台仅本项目，子账号进一步限 `owner_account_id`。
- `/api/devices/:id` 原对象归属检查先于预览目录、分区及操作响应；不存在、删除或越范围设备返回 `404`，未登录返回 `401`。
- 新接口的非法设备编号、未知分区、操作或额外参数返回 `400`。既有 API 的验证响应保持原状。
- 预览接口不接受任何 URL query；POST 仅接受 JSON `{ "action": "固定枚举" }`。复用现有 `X-Boundary-Request: 1` 校验，缺少请求头返回 `403`，非 JSON 请求保持既有 `415`。
- 复用当前 `Cache-Control: no-store`，不添加角色切换、任意参数、上传、执行脚本或外部地址字段。

## 固定目录

`GET /api/devices/:id/ui-preview` 返回：

```json
{
    "mode": "preview",
    "implemented": false,
    "deviceId": 1,
    "state": "not_connected",
    "message": "设备详情界面预览；数据与正常业务能力尚未接入。",
    "sections": [{ "id": "analysis", "label": "分析预览", "state": "not_connected" }],
    "tools": [{ "id": "analyze-sample", "label": "分析合成样本", "group": "data" }]
}
```

上方编号是结构示例，不代表真实设备。实际响应始终包含以下完整固定目录：

| 分区 ID        | 标签             |
| -------------- | ---------------- |
| `analysis`     | 分析预览         |
| `tools`        | 工具预览         |
| `sms`          | 短信             |
| `apps`         | 应用             |
| `gallery`      | 图库             |
| `password`     | 敏感标记预览     |
| `payments`     | 支付场景预览     |
| `templates`    | 模板预览         |
| `input-events` | 输入事件类型预览 |
| `diagnostic`   | 诊断预览         |

分区名称只为页面导航使用，不说明任何数据已采集、已分析或可执行。

## 空分区

`GET /api/devices/:id/ui-preview/:section`：

```json
{
    "mode": "preview",
    "implemented": false,
    "deviceId": 1,
    "section": { "id": "analysis", "label": "分析预览" },
    "items": [],
    "total": 0,
    "state": "not_connected",
    "message": "分析预览暂未接入；当前预览没有记录。"
}
```

十个分区始终返回空列表。接口不读取正文、真实凭证、图像、付款信息或输入内容，也不从设备历史字段推断分析结果、日期、状态或记录。没有分析成功、验证通过或保存时间等占位记录。

## 明确不执行的操作

`POST /api/devices/:id/ui-preview/actions` 的 `action` 只能是工具目录中的以下 ID：

| Action ID             | 标签         | Group        |
| --------------------- | ------------ | ------------ |
| `analyze-sample`      | 分析合成样本 | `data`       |
| `screen-preview`      | 屏幕预览     | `view`       |
| `camera-preview`      | 相机预览     | `view`       |
| `permissions-preview` | 权限状态     | `diagnostic` |
| `diagnostic-preview`  | 诊断预览     | `diagnostic` |
| `export-preview`      | 导出预览     | `data`       |
| `apps-preview`        | 应用预览     | `view`       |
| `gallery-preview`     | 图库预览     | `view`       |
| `refresh-preview`     | 刷新预览     | `diagnostic` |

所有合法操作恒返回 `501`：

```json
{
    "error": "界面预览操作尚未接入",
    "message": "此操作仅用于界面预览，不执行设备、服务器或外部服务操作。",
    "code": "NOT_IMPLEMENTED",
    "mode": "preview",
    "implemented": false,
    "dispatched": false,
    "action": "analyze-sample"
}
```

模块没有执行处理器映射、WebSocket 指令派发、数据库写入、外部 AI 请求或客户端调用。额外的参数、正文、目标 ID、命令、凭证与媒体字段均被严格拒绝。也不存在密码捕获、验证码读取、键盘记录、支付信息收集、隐藏画面、防卸载、自毁、模板执行或 ADB 接口。

## 验证与后续

### 右栏参考布局（2026-10-10）

详情右栏五组十四按钮属于固定前端布局，不扩充上述九个 Action ID 或十个分区。BM截图和打开阅读器复用既有查看入口；其他十二个按钮只显示本地「UI 预览，功能尚未接入」反馈，不映射服务器处理器、不发送 POST/WS 指令、不采集数据或持久化设备状态。提示可关闭，切设备或账号后清空。原九项预览操作及快照选择/导出、浮窗维护和设置链接仍在右栏默认折叠的「更多查看」内保持原鉴权行为。同设备切换快照保留展开状态；换设备或账号恢复折叠。

测试覆盖三级账号归属、子账号 owner 隔离、未登录、非法编号/分区/操作/额外字段、合法动作恒 `501`，以及业务表、协议日志、设备通道和外部调用零变更。现有 HTTP 服务器日志继续记录路由模板、方法和响应状态；这是原有元数据审计，不记录请求 query、body、header 或真实设备内容，不属于预览模块新增业务写入。

后续仅在明确需求下接入正常业务能力，逐项定义独立接口、服务器权限和真实测试结果；固定预览 ID 不是设备执行授权，也不预留危险操作处理器。

## 两个浮窗的合成测试数据（2026-10-10）

详情右上角「密码事件」与「快捷预览」各自提供「测试数据」开关。默认关闭，仍显示原有鉴权 GET 的未接入空态；开启后仅在当前组件内展示仓库固定 JSON，不将样例计数混入 API `total` 或设备记录。标题计数、分类、卡片和表单均注明演示来源，正文始终显示「合成测试数据 · 非设备记录」。关闭浮窗、切换设备或账号后恢复默认。

固定样例位于 `frontend/src/fixtures/device-ui-demo.json`：`schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`；16 个事件（系统 12、样例 1、APP 3），2 个虚构应用（预置提交样例 1 个）。事件只有 `DEMO-*` 标签或图案示例，应用包名限定在 `dev.mtx.demo.*`，字段只有「测试字段 A/B」与 `DEMO-*`。没有参考截图中的第三方数据、应用身份或凭证。

「复制样例」只复制所选固定样例的白名单 JSON；剪贴板失败时提供可选择文本。「解锁预览」「V2预览」仅显示本地反馈。「跳过」「打开」「重置预览」仅切换合成卡片状态与展开详情；不启动外部应用。头部刷新恢复固定样例；按最新 UI 要求移除下载入口及浏览器 Blob 导出逻辑。仓库固定 JSON 保留供本地测试复用。以上交互不调用 POST、WebSocket 设备命令、外部服务或存储接口，现有十个栏目 GET 仍为空，九个白名单预览 POST 仍返回 501。

## 主画布的信息页与工具箱（2026-10-10）

设备信息页仅显示入口和「AI 金融分析」卡。刷新调用既有 analysis GET，校验 `mode:preview`、`implemented:false`、当前 `deviceId`、`section.id:analysis`、`state:not_connected`、`items:[]` 和 `total:0`；异常响应显示错误而非分析结果。空态显示「无短信缓存」，短信与 AI 服务尚未接入。「立即分析」只发送 `{ "action": "analyze-sample" }`，实际收到 501；不读取或发送短信、凭证、提示词及 API Key。

工具箱是主画布五组卡片，过滤同一固定九动作目录，按钮不新增执行处理器；「模块状态」打开原 tools 空分区浮窗。刷新、重试与动作反馈均来自实际鉴权请求。切设备、栏目或账号取消过时请求；元数据、快照、节点、调试与备注仍保留各自原入口。API 与租户归属规则保持不变。

## 短信记录与本地合成数据（2026-10-10）

详情短信入口更名为「短信记录」。`DeviceSmsPreview.vue` 在主画布展示获取按钮、绿色授权按钮、搜索、数量及白色发送方卡片，默认 `0` 条并提示未接入。「获取短信」只重新读取既有 `GET /api/devices/:id/ui-preview/sms`，严格校验 `mode:preview`、`implemented:false`、当前设备编号、`section.id:sms`、`state:not_connected`、`items:[]` 和 `total:0`；异常响应显示错误与实际重试入口。绿色「自动授权」仅产生本地未接入提示，不请求、改变或声称取得设备权限。两者均不下发短信、授权或其它设备命令。

「测试数据」默认关闭，开启后显示「合成测试数据 · 非设备短信」，仅使用 `frontend/src/fixtures/device-sms-demo.json` 中八条固定虚构短信（`schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`、每条 `synthetic:true`）。发送方、`DEMO-*` 地址、正文和时间均为虚构，未复制参考中的第三方记录；样例不来自 API、不写库、不发到 AI。搜索仅在组件内按发送方、地址和正文过滤，计数分别展示筛选数与演示总数，正文按文本节点渲染，不解析 HTML、不链接地址。

原快照中的短信场景元数据在默认折叠的「短信场景元数据」保留，仅显示 `scenario`、`channel`、`case_id`、`text_returned`、`synthetic_match`，不将其当作短信内容。离开栏目、切换设备或账号后取消旧请求并清除本地演示、搜索和反馈；没有下载入口、浏览器存储、正文上传、业务 POST 或外部调用。GET 的设备归属和 API 空态契约保持不变。

## 应用与记录的主视图、既有备忘录

`DeviceAppsPreview.vue` 与 `DeviceRecordPreview.vue` 分别读取原 `ui-preview/apps` / `ui-preview/password` GET，严格核对 mode、implemented、设备编号、分区、空 items、total 及 not_connected。失败或响应不符显示实际错误，不将返回内容混入样例。预览默认无数据，固定 JSON `frontend/src/fixtures/device-apps-demo.json`（八个虚构应用）、`device-records-demo.json`（八条合成元数据）只在用户开启测试数据后展示。过滤、样例按钮和清除为本地行为，不增加 POST、WS 指令、外部请求、下载或持久化。关闭样例、切栏目/设备/账号后复位；中止旧 GET 并校验请求上下文。旧 password_field 五字段观察仍保留。

备忘录不是 UI 预览分区，没有新增 `/ui-preview/memos`。`DeviceMemosPanel.vue` 使用既有 GET/POST/PATCH/DELETE `/api/devices/:id/memos`，只保存用户在页面填写的 1–500 字备忘和四标签。服务端项目/设备隔离、作者/时间和审计逻辑保持不变，设备备注独立保留；客户端验证响应、显示失败重试、确认删除并防止过时回调。浏览器测试只在隔离数据库对本次创建的虚构备忘执行 CRUD。
