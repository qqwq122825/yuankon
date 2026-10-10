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
| `payments`     | 支付密码         |
| `templates`    | 注入记录         |
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

详情右上角「密码事件」与「快捷预览」各自提供「测试数据」开关。锁屏密码与注入应用快捷两个固定浮窗仅对样例来源，在各自首次有效鉴权空态 GET 后默认开启假数据，其他来源仍为空态且校验后可手动开启；非固定通用预览不默认开启；开启后仅在当前组件内展示仓库固定 JSON，不将样例计数混入 API `total` 或设备记录。标题计数、分类、卡片和表单均注明演示来源，正文始终显示「合成测试数据 · 非设备记录」。关闭浮窗、切换设备或账号后恢复默认。

固定样例位于 `frontend/src/fixtures/device-ui-demo.json`：`protocol:mtx-ui-demo/v1`、`datasetId:DEMO-DEVICE-01`、`schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`；16 条锁屏记录（系统 12、假锁 1、APP 3），每条声明 `synthetic:true` 和 `valueType:pin/pattern/type/sample`。数字样例只允许固定 `000000` / `111111` / `222222` / `333333`；另有 `pattern` 类型、DEMO 标签和预设九宫格。原两项 `applications` 保留兼容但不再用于快捷展示。当前注入应用快捷使用独立 `device-injection-match-demo.json` 与 `mtx-injection-match-demo/v1` 协议，按完整包名匹配四项，字段仍为「测试字段 A/B」与固定 `DEMO-*`。这些假值不来自参考截图；正式字段、默认行为和真实 JSON 摘录见 [客户端假数据协议](UI_DEMO_PROTOCOL.md)。

「复制样例」只复制所选固定样例的白名单 JSON，附带 `protocol:mtx-ui-demo/v1`、`schemaVersion:1`、`fixtureOnly:true` 和 `synthetic:true`；剪贴板失败时提供可选择文本。「一键解锁」「V2解锁」仅使用当前选中固定样例的标签和值显示本地合成 UI 反馈，既非设备回执，也不传输或持久化样例值。「跳过」「打开」「重置预览」仅切换合成卡片状态与展开详情；不启动外部应用。头部刷新恢复固定样例；按最新 UI 要求移除下载入口及浏览器 Blob 导出逻辑。仓库固定 JSON 保留供本地测试复用。以上交互不调用 POST、WebSocket 设备命令、外部服务或存储接口，现有十个栏目 GET 仍为空，九个白名单预览 POST 仍返回 501。

## 主画布的信息页与工具箱（2026-10-10）

设备信息页显示入口和「AI 金融分析」卡，默认空态。刷新调用既有 analysis GET，校验 `mode:preview`、`implemented:false`、当前 `deviceId`、`section.id:analysis`、`state:not_connected`、`items:[]` 和 `total:0`；异常响应显示错误而非分析结果。空态显示「无短信缓存」，短信读取与 AI 服务尚未接入。所有来源在 analysis 空态 GET 校验成功后可手动开启「测试数据」，读取 `device-analysis-demo.json` 两项固定摘要，并由 `readAnalysisDemo(fixture, smsFixture)` 校验引用的八条合成短信 ID；摘要不是接口分析结果，不调用 AI。「立即分析」只发送 `{ "action": "analyze-sample" }`，实际收到 501；不读取或发送短信、凭证、提示词及 API Key。

工具箱是主画布五组卡片，过滤同一固定九动作目录，按钮不新增执行处理器；「模块状态」打开原 tools 空分区浮窗。刷新、重试与动作反馈均来自实际鉴权请求。切设备、栏目或账号取消过时请求；元数据、快照、节点、调试与备注仍保留各自原入口。API 与租户归属规则保持不变。

## 短信记录与本地合成数据（2026-10-10）

详情短信入口更名为「短信记录」。`DeviceSmsPreview.vue` 在主画布展示获取按钮、绿色授权按钮、搜索、数量及白色发送方卡片，样例来源经有效鉴权 GET 校验后默认八条假数据，其他来源默认 `0` 条并提示未接入。「获取短信」只重新读取既有 `GET /api/devices/:id/ui-preview/sms`，严格校验 `mode:preview`、`implemented:false`、当前设备编号、`section.id:sms`、`state:not_connected`、`items:[]` 和 `total:0`；异常响应显示错误与实际重试入口。绿色「自动授权」仅产生本地未接入提示，不请求、改变或声称取得设备权限。两者均不下发短信、授权或其它设备命令。

「测试数据」在样例来源首次有效鉴权加载后默认开启，其他来源默认关闭；开启后显示「合成测试数据 · 非设备短信」，仅使用 `frontend/src/fixtures/device-sms-demo.json` 中八条固定虚构短信（`protocol:mtx-sms-demo/v1`、`datasetId:DEMO-DEVICE-01`、`schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`、每条 `synthetic:true`）。发送方、`DEMO-*` 地址、正文和时间均为虚构，未复制参考中的第三方记录；样例不来自 API、不写库、不发到 AI。搜索仅在组件内按发送方、地址和正文过滤，计数分别展示筛选数与演示总数，正文按文本节点渲染，不解析 HTML、不链接地址。

原快照中的短信场景元数据在默认折叠的「短信场景元数据」保留，仅显示 `scenario`、`channel`、`case_id`、`text_returned`、`synthetic_match`，不将其当作短信内容。离开栏目、切换设备或账号后取消旧请求并清除本地演示、搜索和反馈；没有下载入口、浏览器存储、正文上传、业务 POST 或外部调用。GET 的设备归属和 API 空态契约保持不变。

## 应用与记录的主视图、既有备忘录

`DeviceAppsPreview.vue` 与 `DeviceRecordPreview.vue` 分别读取原 `ui-preview/apps` / `ui-preview/password` GET，严格核对 mode、implemented、设备编号、分区、空 items、total 及 not_connected。失败或响应不符显示实际错误，不将返回内容混入样例。服务端预览始终返回空数据。固定 JSON `frontend/src/fixtures/device-apps-demo.json` 提供统一的八项合成应用目录；sample 来源有效鉴权空态 GET 后默认展示六项用户应用，勾选系统应用后展示八项，其他来源校验后手动开启；`device-records-demo.json` 提供 24 条合成记录（类型列为 APP 琥珀标签、键盘普通加粗文本、PIN 蓝色标签；14/9/1 条，仅用于样例分类），包含 A / B / 样例系统设置三个虚构应用来源、时间、长文本与转义标签。密码记录组件接收 `deviceSource`，仅 `source=sample` 的测试设备在首次成功校验鉴权 GET 后自动展示；其他设备默认关闭，也可显式开启同一份样例。初次失败或响应不符不自动展示；刷新保留手动开关和筛选。页面始终显示合成来源，数据不来自设备或服务端。过滤、样例按钮和清除为本地行为，不增加 POST、WS 指令、外部请求、下载或持久化。关闭样例清空筛选；切栏目/设备/来源/账号后重置并重新按来源初始化，中止旧 GET 并校验请求上下文。无浏览器存储或数据库写入，旧 password_field 五字段观察仍保留。

备忘录不是 UI 预览分区，没有新增 `/ui-preview/memos`。`DeviceMemosPanel.vue` 使用既有 GET/POST/PATCH/DELETE `/api/devices/:id/memos`，只保存用户在页面填写的 1–500 字备忘和四标签。服务端项目/设备隔离、作者/时间和审计逻辑保持不变，设备备注独立保留；客户端验证响应、显示失败重试、确认删除并防止过时回调。浏览器测试只在隔离数据库对本次创建的虚构备忘执行 CRUD。另有 `device-memos-demo.json` 的两条只读假备忘，所有来源默认关闭；原鉴权 GET 返回合法 data 数组、total 与既有记录字段后，可手动测试数据，不要求原列表为空。合成区没有编辑、删除或保存动作，不将其记录加入 API data 或 CRUD。

## 支付密码与注入记录的固定假数据（2026-10-10）

详情左菜单将「支付场景」更名为「支付密码」，移除独立「模板预览」入口，并按参考布局新增「注入记录」主画布。原 `payments` / `templates` 分区 ID 保持兼容，目录显示标签同步调整；右上角快捷预览浮窗仍独立保留。

`DevicePaymentPreview.vue` 使用应用搜索与选择侧栏、应用名称/包名标题、总记录/成功样例/不同样例三个统计块，以及带时间和样例状态的竖向卡片。`device-payments-demo.json` 包含四个虚构应用及 24 条固定记录；计数从当前应用的样例推导，不使用参考图中的第三方身份、真实密码或虚构设备采集结果。

`DeviceInjectionRecordsPreview.vue` 提供「刷新记录」「手动注入APP」「弹窗注入」三按钮、追踪状态条和样例记录卡。`device-injection-records-demo.json` 包含三个虚构应用及六条固定记录，表单字段固定为 `password` 与 `PIN` 两项，值为四位数字合成样例（例如 `password: 9519`），不显示真实凭证或任意表单正文。手动选择与弹窗只改变本页演示；记录刷新恢复固定样例，不启动应用、不发送模板、不提交表单。

两页复用 `useDeviceDemoPreview.js`：仅在对应已鉴权 GET 满足 `mode:preview`、`implemented:false`、当前设备 ID、对应分区 ID、`state:not_connected`、`items:[]` 与 `total:0` 后开放演示。测试设备 `source=sample` 首次成功加载即展示假数据；其他来源默认空态，可点击「测试数据」。开关/筛选为组件内存状态，刷新保留开关；请求等待、失败或非法契约时隐藏假数据，切设备/来源/账号或离开栏目清除旧上下文并取消过时响应。

样例分别声明 `mtx-payments-demo/v1` / `mtx-injection-records-demo/v1`，统一带 `datasetId:DEMO-DEVICE-01`、`schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`、`synthetic:true`，应用限定 `dev.mtx.demo.*`，界面标注「合成测试数据 · 非设备记录」。两个 GET 仍返回零项，原九个 POST 仍恒返回 501；此次不新增设备指令、数据库写入、外部请求或存储。验证见 `frontend/test/device-payment-injection.spec.js` 和 `backend/test/payment-injection-fixture.test.js`。

## 单台本机样例与锁屏密码浮窗（2026-10-10）

本次仅将本机 8083 私有演示数据的可见测试设备由五台改为一台；多余四条合成行软删除且保留原状态备份。正式 Store、接入流程、HTTP/WS 隔离及独立 E2E 多设备种子不改。重启脚本只创建固定第一台并幂等隐藏原四台样例。

锁屏浮窗仍使用 `password` 分区的鉴权 GET，现增加设备编号、分区编号、空 items 和 total=0 校验，等待/异常/鉴权失败均不展示样例；上下文同步复位并中止迟到响应。浮窗标题「锁屏密码」，固定十六条（系统十二、假锁一、APP 三）；第一条为系统PIN `000000` 并默认选中，第四条为锁类型 `pattern`；三条 APP密码为固定 `111111` / `222222` / `333333`，其他图案渲染预设格点与序列。`mtx-ui-demo/v1` 只规范前端 fixture 与合成复制结果，不新增设备协议，详见 [UI 假数据协议](UI_DEMO_PROTOCOL.md)。原两项应用仅保留兼容，当前快捷窗的数据来自独立匹配协议。界面持续注明合成来源，分类、复制与两个本地反馈按钮不发送设备指令；没有新增采集、授权、解锁或正文写入接口。

短信页共享同样的空态 gate：样例设备默认八条，其他来源默认空；刷新保留手动开关/搜索，等待或失败隐藏假数据，切设备/来源/账号清空旧状态。短信 fixture 正文与标识未改，仅固定日期改为 2026-10-10；完整时间与五色头像用于布局展示，不将参考中的第三方数据或验证码写入样例。

## 全局注入列表与客户端快捷匹配（2026-10-10）

本轮仅新增固定客户端合同 `mtx-injection-match-demo/v1`，文件为 `frontend/src/fixtures/device-injection-match-demo.json`。它包含 `registryId:DEMO-REGISTRY-01`、`installedReportId:DEMO-INSTALLED-01`、六项 `globalInjectionList`、六项 `installedApplications` 与六项 `applicationStates`；所有行明确 `synthetic:true`，不是手机或 APK 扫描报告。

全局六项中五项启用、一项停用；启用项与已安装集合使用完整包名、区分大小写精确求交，得到 A–D 四项。E 未安装、F 停用、G 未列入全局，均不匹配。快捷窗标题「注入应用快捷」、顶栏开关「快捷预览」，正文仍标明全局 6 / 已安装 6 / 匹配 4。基础匹配状态仍为三卡跳过、一卡已注入；独立提交展示层使 A 默认绿色「已提交 (示例)」并展开固定密码 / PIN，其他三卡折叠，标题计数为「已提交 1/4」。D 卡原两字段 `DEMO-D001` / `DEMO-D002` 保留。打开只展开固定详情，跳过仅切换本地状态及提交计数，重置恢复原固定值及 A 默认展开。

`injection-demo-match.js` 对整份 fixture 标记、三个 0–100 项数组、每个数组内部唯一 ID / 包名、启用布尔值、状态枚举、时间格式及字段白名单统一校验。非法项、缺失标记或匹配项缺少状态使整份结果 `valid:false`、全部计数零、应用空数组；不局部保留坏数据。额外字段忽略，返回的应用和嵌套字段按白名单新建对象，界面不修改导入的 fixture。完整长度、枚举、JSON 摘录与边界见 [UI 假数据协议](UI_DEMO_PROTOCOL.md)。

锁屏密码 / 快捷两个固定浮窗在 sample 来源各自有效鉴权空态 GET 后默认开启；其他来源需手动开启，非固定通用预览不默认展示。等待、失败、非法契约及鉴权失效隐藏假数据；刷新保留手动选择，上下文切换取消迟到请求并重置。

`/injection` 的只读全局六行位于工作流程卡之后、地区网格之前，超管、总台和子账号展示同一份固定列表。它与既有 45 地区内存编辑器没有保存或联动。原 `device-ui-demo.json` 两项应用保留兼容但不再快捷展示；应用列表八项与本匹配报告六项关联同一 `datasetId:DEMO-DEVICE-01`；报告六项为目录六个用户应用的精确子集，两项系统应用不计入该报告。这是固定假数据关联，不作为实际扫描。十个预览 GET 仍返回空数据，九个预览 POST 仍为 501 / `dispatched:false`；本轮不新增 POST、WS、业务存储、采集或设备执行。验证由 `backend/test/injection-match-fixture.test.js`、`frontend/test/device-panel-demo.spec.js` 与 `frontend/test/injection-settings.spec.js` 覆盖。

### 合成提交字段展示层（2026-10-11）

`frontend/src/fixtures/device-injection-submission-demo.json` 使用独立 `mtx-injection-submission-demo/v1`，包含版本、`fixtureOnly:true`、合成来源、`records` 以及各行 `synthetic:true`。每行通过 `applicationId` 与完整 `packageName` 双重关联已匹配应用，声明 `submittedAt` UTC 时间与 `fields` 的 `kind` / `label` / `sampleValue`。字段仅允许 `password`（密码）或 `pin`（PIN），字符串假值仅固定四种 `000000` / `111111` / `222222` / `333333`；本文件 A 两字段均为 `000000`，页面按类型循环渲染，不内嵌样例数组。

`injection-submission-demo.js` 校验整份合同、上限、唯一性、真实日历时间、字段白名单和精确应用引用，按白名单深复制输出。非法输入隐藏整份合成快捷数据。显示 `submitted` 是本地假状态，不是设备提交回执。此层不改变 HTTP GET 空态、501 动作合同、WS 或存储；完整字段与 JSON 见 [UI 假数据协议](UI_DEMO_PROTOCOL.md)，测试新增 `backend/test/injection-submission-fixture.test.js`。

## 全栏目假数据审查与协议层（2026-10-11）

客户端固定数据统一声明 `datasetId:DEMO-DEVICE-01`，仅表示同一组虚构样例，不等于 `deviceId`、账号、设备凭证或采集会话。apps / sms / records / payments / injection-records / gallery / analysis / memos 分别使用独立模块协议，加上锁屏 / 匹配 / 提交的 v1，共十一份静态 JSON。相册两张自制 SVG、分析两项固定摘要、备忘两条只读样例均默认关闭、鉴权校验后手动展示。主应用目录八项与已安装报告六项统一包名关联；本地记录外键使用模块内 ID，跨模块通过完整包名关联。应用页另外从全局启用列表派生未安装 E 的只读说明行（`.app-configured-row`），不作为设备应用、不计入六用户 / 八总数或四项匹配。规范、准备数量、字段与示例统一见 [UI 假数据协议](UI_DEMO_PROTOCOL.md)。

共享 fixture reader 与已鉴权 GET gate 各司其职：reader 只对静态源码进行协议、标记、唯一性、上限、类型、有效日期、外键与目录关联校验并白名单复制；UI 预览 gate 仍核对当前设备 / 分区与 mode / implemented / state / 空 items / total=0；备忘使用原 `/memos` 响应的独立鉴权 / 字段检查，不套用空分区合同。八个主画布 reader 的空集合合法，任一非法合同整份空态；锁屏入口 readLockDemo 也整份校验，typed 子组件的行过滤 / DEMO-UNSET 仅是后备防御；不将 API 返回内容或额外字段拼进假数据，不把 UI 呈现当作采集或执行验证。

相册页保留默认透明画布与居中空态，「获取相册」仍只刷新 gallery 空接口；手动测试数据显示固定两图，不采集或下载手机相册。分析固定摘要不替代 `analyze-sample` 的 501 反馈；备忘使用既有 `/memos` GET，不增加第十一个 UI 预览分区。

这里补齐的是假数据与协议字段，不新增服务器业务能力。十个栏目 GET、九个 501 预览动作与设备隔离保持不变；既有备忘 CRUD、截图查看、节点与 API 调试遵循原真实接口，不因新增假数据获得新的设备指令。后续浏览器逐栏目核查结果独立记录。
