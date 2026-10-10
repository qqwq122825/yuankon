# 本机 UI 假数据协议

## 标识与用途

锁屏密码浮窗使用客户端固定样例协议 `mtx-ui-demo/v1`。协议定义仓库 JSON、Vue 展示及「复制样例」的合成数据格式；它不是手机采集协议、设备密码接口或远程操作协议。

固定文件：`frontend/src/fixtures/device-ui-demo.json`。十六条 `lockEvents` 分类为系统十二条、假锁一条、APP 三条；原有两项 `applications` 作为旧兼容数据保留，不再用于注入应用快捷展示。快捷窗改用本文后半部分的独立匹配协议。所有数字与图案都是预设假值，参考截图只用于布局，不复制参考中的真实值、第三方身份或设备记录。界面持续显示「合成测试数据 · 非设备记录」。

协议常量、四个类型、四个允许 PIN 与值 / 图案校验集中在 `frontend/src/fixtures/device-demo-protocol.js`。浮窗小标显示「协议 v1 · 固定假值」，悬停可见完整协议标识。

当前实现沿用 Vue + Node 同域本机工作台；样例只在当前组件内存与静态源码中展示，不新增部署、数据库、浏览器持久化、正文上传或外部调用。

## 固定文件顶层字段

| 字段            | 类型 / 固定值                  | 说明                                 |
| --------------- | ------------------------------ | ------------------------------------ |
| `protocol`      | string，`mtx-ui-demo/v1`       | 锁屏样例协议版本                     |
| `schemaVersion` | number，`1`                    | 现有 fixture 结构版本，保持兼容      |
| `datasetId`     | string，`DEMO-DEVICE-01`       | 关联同一组固定样例，不是设备编号     |
| `source`        | string，`synthetic-ui-fixture` | 整份文件来自固定合成样例             |
| `fixtureOnly`   | boolean，`true`                | 仅用于本地 UI 测试                   |
| `description`   | string                         | 对假数据来源的说明                   |
| `lockEvents`    | object[]，固定十六条           | 本文定义的锁屏样例                   |
| `applications`  | object[]，既有两项             | 旧兼容应用样例，不再用于当前快捷浮窗 |

`protocol`、`schemaVersion` 与 `datasetId:DEMO-DEVICE-01` 都须匹配。其他使用 `schemaVersion:1` 的旧 fixture 不自动成为 `mtx-ui-demo/v1` 数据。

## 每条锁屏样例

| 字段          | 类型 / 约定                                     | 说明                                                 |
| ------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `id`          | string，固定 `DEMO-EVENT-01` 至 `DEMO-EVENT-16` | 样例唯一编号，不是设备或会话编号                     |
| `category`    | `system` / `scenario` / `app`                   | UI 标签分别为系统 / 假锁 / APP                       |
| `label`       | string                                          | 固定样例标签，例如系统PIN、系统图案、锁类型、APP密码 |
| `valueType`   | `pin` / `pattern` / `type` / `sample`           | 值的展示类型，定义见下表                             |
| `sampleValue` | string                                          | 固定假值；PIN 必须保留字符串形式                     |
| `source`      | string，`dev.mtx.demo.*`                        | 此条记录的虚构组件标识，不是顶层来源字段             |
| `time`        | string，固定 `HH:mm:ss`                         | 演示时间，不代表设备上报                             |
| `synthetic`   | boolean，`true`                                 | 每条记录单独标记为合成数据                           |
| `pattern`     | number[]，图案类型使用                          | 预设九宫格序列；非图案值不绘制点阵                   |

`DeviceLockEventDemo` 单组件的防御性归一化只检查 `HH:mm:ss` 数字格式，格式不符显示 `--:--:--`。正常固定文件入口先经过下文 `readLockDemo` 整份校验，额外要求小时 00–23、分 / 秒 00–59；非法时间使整份文件为空，不会进入这个后备展示分支。

### 四种值类型

| `valueType` | 值约定                                                            | 固定样例 / 展示                                                                                   |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pin`       | 只允许字符串 `000000`、`111111`、`222222`、`333333`               | 首条系统PIN为 `000000`；最后三条 APP密码依次为 `111111`、`222222`、`333333`；数字直接作为文本显示 |
| `pattern`   | `sampleValue` 为固定「图案示例 A–Z」标签，另有有效 `pattern` 数组 | 同时显示九宫格亮点与 `1 → 2 → 3 → 6` 形式的预设序列                                               |
| `type`      | 固定字符串 `pattern`                                              | 第四条锁类型，用来展示类型名，不解释为输入或操作                                                  |
| `sample`    | 固定 `DEMO-*` 标签                                                | 第七、十、十三条纯合成标记，不代表密码值                                                          |

任意其他纯数字、任意真实凭证或由接口返回的正文均不进入锁屏样例。正常固定文件先通过 `readLockDemo` 整份校验；以下行过滤、替代值和空图案为子组件在直接收到不合规 records 时的后备防御，不表示非法仓库 fixture 能部分通过。显示与复制使用白名单对象，不把额外字段透传到剪贴板。缺少 `synthetic:true` 或 `valueType` 不属于四个枚举的记录整体过滤；已标记且类型合法、但 `sampleValue` 不符合该类型允许值的记录保留行，值替换为 `DEMO-UNSET`。无效图案或非 `pattern` 类型的图案替换为空数组，不绘制点阵。

### 九宫格编号

编号从左上角开始，逐行排列：

```text
1 2 3
4 5 6
7 8 9
```

`pattern` 仅使用 1–9 的整数，长度为二至九点，不重复；数组顺序就是箭头展示顺序。例如 `[1, 2, 3, 6]` 点亮第一行三个点与第二行右侧点。它是固定图形描述，不生成手势、坐标或设备指令。

## 固定 JSON 示例

以下两条记录来自上述固定文件，展示的是样例摘录；完整文件仍为十六条，不用两条摘录替换完整 fixture。

首条数字 PIN：

```json
{
    "id": "DEMO-EVENT-01",
    "category": "system",
    "label": "系统PIN",
    "valueType": "pin",
    "sampleValue": "000000",
    "source": "dev.mtx.demo.system",
    "time": "09:40:00",
    "synthetic": true
}
```

第二条九宫格图案：

```json
{
    "id": "DEMO-EVENT-02",
    "category": "system",
    "label": "系统图案",
    "valueType": "pattern",
    "sampleValue": "图案示例 B",
    "source": "dev.mtx.demo.system",
    "time": "09:39:00",
    "synthetic": true,
    "pattern": [1, 2, 3, 6]
}
```

Vue 使用文本插值展示标签、数值、来源和时间；点阵由固定数字数组渲染。JavaScript 不使用 `v-html`、脚本求值或网页模板执行来解释这些值。

## 默认显示与鉴权状态

1. 右上「密码事件」开关仍打开标题为「锁屏密码」的固定浮窗；窗口宽度、右侧位置和拖动行为沿用现有组件。
2. 先读取原 `GET /api/devices/:id/ui-preview/password`。同时核对登录状态、当前设备与分区、`mode:preview`、`implemented:false`、`state:not_connected`、`items:[]`、`total:0`。
3. 只有有效鉴权空态响应完成后，`device.source=sample` 的两个固定浮窗首次默认展示各自假数据：密码浮窗展示十六条并选中首条 `000000`；快捷窗通过其 `templates` 空态 GET 后展示四个匹配应用。其他来源默认空态，校验完成后可手动开启。
4. 用户手动开关只影响当前实例；请求等待、失败、非法响应或鉴权失效时隐藏样例并禁用切换。有效刷新保留当前开关选择，设备 / 来源 / 账号 / 分区切换清空旧上下文并中止过期请求。
5. 快捷窗标题为「注入应用快捷」、顶栏入口仍为「快捷预览」，假数据开关与锁屏浮窗互不影响；只有非固定通用预览不默认展示测试数据。关闭、重新打开或上下文切换后按来源重新初始化默认值。旧两项 `applications` 不参与当前快捷匹配。

本机 8083 列表保留一台可见合成设备，不改变正式接入或隔离测试中的多设备种子。

## 复制格式与按钮行为

「复制样例」在所选记录的白名单字段之外，附带 `protocol:"mtx-ui-demo/v1"`、`schemaVersion:1`、`fixtureOnly:true`、`synthetic:true`。可复制字段为 `id`、`category`、`label`、`valueType`、`sampleValue`、`source`、`time` 和 `pattern`；副本使用按上述规则重建后的记录。原 fixture 的 `pattern` 字段仅用于图案记录；复制对象始终有 `pattern` 数组，非图案记录为 `[]`。仓库顶层新增的 `datasetId` 不加入既有复制格式，剪贴板合同保持兼容。空图案数组不产生点阵或操作。

默认选中首条时，复制结果为以下完整 JSON：

```json
{
    "protocol": "mtx-ui-demo/v1",
    "schemaVersion": 1,
    "fixtureOnly": true,
    "synthetic": true,
    "id": "DEMO-EVENT-01",
    "category": "system",
    "label": "系统PIN",
    "valueType": "pin",
    "sampleValue": "000000",
    "source": "dev.mtx.demo.system",
    "time": "09:40:00",
    "pattern": []
}
```

复制使用浏览器剪贴板；失败时提供本地可选择文本。底部两个按钮的中文名修正为「一键解锁」「V2解锁」，名称不表示远程解锁已经接入；本轮交付仅为合成 UI / mock 反馈。点击时，当前选中的固定样例标签与展示值用于本页面反馈，`role="status"` 明确标注为仅本地合成 UI 反馈，不是设备回执、执行结果或手机状态验证；这些值不发送、不持久化。

分类、记录选择、复制与两个按钮仅改变本地显示或反馈，不下发解锁、自动点击、手势、脚本、短信或模板命令，不传输密码。本轮不新增命令、API 或 WS 消息；`mtx-ui-demo/v1`、十六条固定样例及上述复制白名单字段均保持不变，页面没有样例下载入口。

## 与 Node 空接口及短信样例的关系

- Node 的十个 UI 预览 GET 仍返回 `implemented:false`、`items:[]`、`total:0`。十六条前端样例不混入 API 计数、设备记录或研究日志。
- 原九个预览 POST 仍返回 HTTP 501、`dispatched:false`；此次协议没有新增 POST、WS 消息或设备处理器。
- 设备接入、查看租约、截图及节点传输仍遵循各自既有文档。`mtx-ui-demo/v1` 不替代它们，不说明任何密码、短信、采集或解锁功能已接入。
- 短信固定文件 `frontend/src/fixtures/device-sms-demo.json` 声明独立 `protocol:mtx-sms-demo/v1`、`datasetId:DEMO-DEVICE-01`，保留 `schemaVersion:1`、`source:synthetic-ui-fixture`、`fixtureOnly:true`。八条 `messages` 的白名单字段仍为 `id`、`sender`、`address`、`body`、`receivedAt`、`synthetic:true`；短信不使用锁屏的 `valueType`。
- 短信页同样先校验 `ui-preview/sms` 鉴权空态，样例来源默认展示，其他来源手动开启；内容为固定虚构文本，不解析 HTML，不上传或发送外部 AI。

接口细节见 [设备 UI 预览 API](DEVICE_UI_PREVIEW.md)，尺寸与交互见 [UI 设计](UI_DESIGN.md)。协议、默认状态及字段校验由 `backend/test/ui-demo-fixture.test.js` 和 `frontend/test/device-panel-demo.spec.js` 覆盖；短信继续由原短信 fixture 与浏览器测试覆盖。

## 注入应用匹配协议 `mtx-injection-match-demo/v1`

此独立客户端协议定义「全局注入列表（假数据）」与「注入应用快捷」的数据交集，不是 APK 模板、手机扫描、设备采集或注入执行协议。完整文件为 `frontend/src/fixtures/device-injection-match-demo.json`，协议常量与整份校验 / 匹配逻辑集中于 `frontend/src/fixtures/injection-demo-match.js`。它不改变上文锁屏协议、短信 fixture、后端预览 ID 或空接口。

### 顶层合同与列表字段

| 字段                    | 类型 / 约定                           | 说明                               |
| ----------------------- | ------------------------------------- | ---------------------------------- |
| `protocol`              | string，`mtx-injection-match-demo/v1` | 必须严格匹配协议常量               |
| `schemaVersion`         | number，`1`                           | 必须严格匹配                       |
| `datasetId`             | string，`DEMO-DEVICE-01`              | 须匹配共同样例数据集               |
| `source`                | string，`synthetic-ui-fixture`        | 固定合成来源                       |
| `fixtureOnly`           | boolean，`true`                       | 仅 UI 假数据                       |
| `registryId`            | string，`DEMO-REGISTRY-01`            | 本文件的固定全局列表标识           |
| `installedReportId`     | string，`DEMO-INSTALLED-01`           | 本文件的固定已安装报告标识         |
| `globalInjectionList`   | object[]，0–100 项；本文件六项        | 名称、初始字母、示例包名与启用状态 |
| `installedApplications` | object[]，0–100 项；本文件六项        | 合成已安装包名报告，不读取手机     |
| `applicationStates`     | object[]，0–100 项；本文件六项        | 合成状态与固定字段                 |
| `description`           | string                                | 来源说明，不进入匹配结果           |

三个数组均须存在；零项是允许的有效空集合。数组中的每行必须为非空、非数组对象，包含 `synthetic:true`、`id` 与 `packageName`；每个数组内的 `id` 与 `packageName` 分别唯一。不同数组用包名关联，ID 不要求跨数组相同或跨数组唯一。

| 每行字段         | 适用列表     | 校验 / 展示                                                                                        |
| ---------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `id`             | 三个列表     | `DEMO-` 加大写字母、数字、下划线或连字符，整个标识长度不超过 64；顶层两个 ID 同样校验              |
| `packageName`    | 三个列表     | `dev.mtx.demo.` 前缀；后续每段以小写字母开头，之后仅小写字母、数字、下划线，段间以点分隔           |
| `synthetic`      | 三个列表     | 必须为布尔 `true`，不将字符串或其他值当作合成标记                                                  |
| `name`           | 全局列表     | 「样例」前缀，非空字符串，长度最多 60                                                              |
| `initial`        | 全局列表     | 非空字符串，长度一至二；文本首字图标                                                               |
| `enabled`        | 全局列表     | 严格布尔值；停用项不进入匹配                                                                       |
| `status`         | 状态列表     | 仅 `skipped` / `injected`；此为基础状态，不含下文独立提交展示层的 `submitted`                      |
| `time`           | 状态列表     | 数字格式 `MM/DD HH:mm`，只验证格式，不验证日历或范围                                               |
| `fields`         | 状态列表     | 数组，零至二项；每项为非空、非数组对象                                                             |
| `fields[].label` | 状态列表字段 | 仅「测试字段 A」或「测试字段 B」                                                                   |
| `fields[].value` | 状态列表字段 | 固定 `DEMO-` 标签；后续为一至 64 个大写字母、数字、下划线或连字符，不接受任意凭证、数字正文或 HTML |

匹配后的应用只含 `id`、`name`、`initial`、`packageName`、`status`、`time`、`fields`、`skip` 与 `synthetic:true`；`skip` 由 `status === 'skipped'` 推导，字段副本只含 `label` / `value`。额外字段忽略而不透传；返回的每个应用和每个嵌套字段均新建对象。Vue 只用文本插值，不使用 HTML / 模板执行解释名称或字段。

### 精确交集与固定结果

1. 先统一校验顶层标记、三个完整列表、类型、长度、枚举与每列表内唯一性。
2. 从 `installedApplications` 的完整 `packageName` 建集合；只从全局列表选择 `enabled:true` 且在该集合内的项，保留全局列表顺序。
3. 使用完整包名、区分大小写的相等比较，不进行包含、前缀、模糊、大小写归一化匹配。
4. 每个匹配项必须在 `applicationStates` 中有状态；多余未匹配状态可以存在，但不展示。
5. 任一校验失败，或任一匹配项缺少状态，整份结果为 `valid:false`、三个计数均零、`applications:[]`。不忽略坏行后继续宣称有效部分匹配；只有三份列表均合法的空交集才是 `valid:true`、`matchedCount:0`。

固定文件中全局六项、其中五项启用 / 一项停用，已安装报告六项，交集四项：

| 全局 / 报告样例              | 全局启用 | 已安装报告包含 | 结果 / 初始状态                |
| ---------------------------- | -------- | -------------- | ------------------------------ |
| A，`dev.mtx.demo.pay.a`      | 是       | 是             | 匹配，`skipped`                |
| B，`dev.mtx.demo.wallet.b`   | 是       | 是             | 匹配，`skipped`                |
| C，`dev.mtx.demo.bank.c`     | 是       | 是             | 匹配，`skipped`                |
| D，`dev.mtx.demo.app.d`      | 是       | 是             | 匹配，`injected`，两项固定字段 |
| E，`dev.mtx.demo.shop.e`     | 是       | 否             | 未安装，排除                   |
| F，`dev.mtx.demo.helper.f`   | 否       | 是             | 停用，排除                     |
| G，`dev.mtx.demo.unlisted.g` | 不在全局 | 是             | 未列入全局，排除               |

合法整份固定匹配文件返回 `valid:true`、`registryCount:6`、`installedCount:6`、`matchedCount:4`。匹配统计仍为 4/6，分母是报告六项而非全局启用五项；来源行显示「全局 6 · 已安装 6 · 匹配 4」。叠加下文独立提交假数据后，快捷窗标题计数默认改为「已提交 1/4」，分母为四个匹配应用。两种计数仅描述静态样例，不证明手机安装、扫描或表单提交结果。

### 固定 JSON 摘录与返回示例

下面是完整文件中 D 的合同摘录，顶层保留协议与合成标记，各列表只摘录 D 一项；它不是六项完整 fixture 的替代品。作为独立输入时，此摘录有效且返回 1 / 1 / 1，而非完整文件的 6 / 6 / 4。

```json
{
    "protocol": "mtx-injection-match-demo/v1",
    "datasetId": "DEMO-DEVICE-01",
    "schemaVersion": 1,
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "registryId": "DEMO-REGISTRY-01",
    "installedReportId": "DEMO-INSTALLED-01",
    "globalInjectionList": [
        {
            "id": "DEMO-TEMPLATE-D",
            "name": "样例应用 D",
            "initial": "D",
            "packageName": "dev.mtx.demo.app.d",
            "enabled": true,
            "synthetic": true
        }
    ],
    "installedApplications": [
        {
            "id": "DEMO-INSTALLED-D",
            "packageName": "dev.mtx.demo.app.d",
            "synthetic": true
        }
    ],
    "applicationStates": [
        {
            "id": "DEMO-STATE-D",
            "packageName": "dev.mtx.demo.app.d",
            "status": "injected",
            "time": "01/01 09:37",
            "fields": [
                {
                    "label": "测试字段 A",
                    "value": "DEMO-D001"
                },
                {
                    "label": "测试字段 B",
                    "value": "DEMO-D002"
                }
            ],
            "synthetic": true
        }
    ]
}
```

完整文件匹配结果中的 D 应用如下；状态来自固定状态行，`skip:false` 为推导值，嵌套字段是白名单副本：

```json
{
    "id": "DEMO-TEMPLATE-D",
    "name": "样例应用 D",
    "initial": "D",
    "packageName": "dev.mtx.demo.app.d",
    "status": "injected",
    "time": "01/01 09:37",
    "fields": [
        {
            "label": "测试字段 A",
            "value": "DEMO-D001"
        },
        {
            "label": "测试字段 B",
            "value": "DEMO-D002"
        }
    ],
    "skip": false,
    "synthetic": true
}
```

非法合同或匹配项缺少状态的完整返回值：

```json
{
    "valid": false,
    "protocol": "mtx-injection-match-demo/v1",
    "registryCount": 0,
    "installedCount": 0,
    "matchedCount": 0,
    "applications": []
}
```

### 显示、局部交互与兼容数据

- 顶栏「快捷预览」打开标题为「注入应用快捷」的固定窗。只有当前账号、设备与 `templates` 分区的有效鉴权空态 GET 完成后开放数据开关；`device.source=sample` 首次默认展示匹配四卡，其他来源默认关闭并可手动展示。`password` 固定窗仍按锁屏协议独立默认展示十六条；通用非固定预览不默认开启。
- 请求等待、失败、非法响应、鉴权失效时隐藏匹配数据并禁用切换；有效刷新保留选择，关闭重开与设备 / 来源 / 账号 / 分区变化重新初始化并取消过期请求。前端样例不混入 API `items`、`total`、设备记录或日志。
- `DeviceTemplateDemo.vue` 检查并克隆匹配应用及独立提交假数据。基础 match v1 仍为 A–C 跳过、D 已注入；叠加提交 fixture 后，A 默认显示绿色「已提交 (示例)」并展开固定「密码 / PIN」两字段，其他 B–D 三卡默认折叠。D 的 `DEMO-D001` / `DEMO-D002` 字段保留，B / C 无提交字段。「打开」只展开本地详情，不启动外部应用。
- 「跳过」只改变局部 `skip` 与展示状态，已提交计数随本地状态更新，不改变字段或提交任何内容；「重置预览」与全部重置从独立原始副本恢复 JSON 的初始状态，包括 A 已提交并展开、其他三卡折叠，不修改导入 JSON、全局列表或父组件对象。刷新恢复固定卡片状态，界面不提供 APK、脚本、真实表单输入或样例下载。
- `/injection` 工作流程卡之后、APP 地区网格之前的「全局注入列表（假数据）」使用同一份整体校验，显示全局六行、五项样例启用 / 一项样例停用；协议标识和只读来源始终可见。超管、总台与子账号看同一份固定全局列表。新列表没有输入、保存、持久化或网络调用，与原 45 地区、每区十二项模板的内存编辑器不联动，原角色守卫保持。
- 原 `device-ui-demo.json` 两项 `applications` 仅保留旧兼容格式，不再参与快捷展示。主画布 `device-apps-demo.json` 的统一八项目录与本报告六项共享 `DEMO-DEVICE-01`；报告是六个用户应用的精确子集，两项系统应用不计入该报告。统一假数据关联不代表真实安装或扫描。
- 十个栏目 GET 仍返回 `implemented:false`、`items:[]`、`total:0`；九个白名单 POST 仍为 HTTP 501、`dispatched:false`。匹配协议不新增 POST、WS、设备执行、APK 构建或手机扫描，也不改变当前 Vue + Node 本机工作台与部署方式。

本协议验证由 `backend/test/injection-match-fixture.test.js`、`frontend/test/device-panel-demo.spec.js` 与 `frontend/test/injection-settings.spec.js` 覆盖。

## 独立提交假数据协议 `mtx-injection-submission-demo/v1`

「已提交」卡片使用独立静态文件 `frontend/src/fixtures/device-injection-submission-demo.json`，校验与关联集中在 `frontend/src/fixtures/injection-submission-demo.js`。名称、表单、密码 / PIN 和时间均为预设合成展示，不是捕获、真实提交或设备回执；页面不硬编码该记录，也不读取设备输入。此协议不改写 `mtx-injection-match-demo/v1` 的六项全局 / 六项已安装 / 四项交集，也不改变锁屏的 `mtx-ui-demo/v1`、十六样例或复制字段。

### 字段合同

| 顶层字段        | 类型 / 约定                                | 说明                             |
| --------------- | ------------------------------------------ | -------------------------------- |
| `protocol`      | string，`mtx-injection-submission-demo/v1` | 严格匹配独立提交协议常量         |
| `schemaVersion` | number，`1`                                | 严格匹配                         |
| `datasetId`     | string，`DEMO-DEVICE-01`                   | 须匹配共同样例数据集             |
| `source`        | string，`synthetic-ui-fixture`             | 固定合成来源                     |
| `fixtureOnly`   | boolean，`true`                            | 仅 UI 假数据                     |
| `records`       | object[]，0–100 项                         | 本文件一条；零条是有效空提交集合 |
| `description`   | 可选说明                                   | 不参与关联，也不透传给展示记录   |

每条记录必须为非空、非数组对象；`id`、`applicationId`、`packageName` 各自在 `records` 中唯一。每个应用最多关联一条提交假数据，不把不同包名的记录合并。

| 每条记录字段           | 类型 / 校验                                                     | 说明                                                                                               |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                   | string，`DEMO-` 加大写字母、数字、下划线或连字符；总长不超过 64 | 本文件 `DEMO-SUBMISSION-A`                                                                         |
| `applicationId`        | 同上                                                            | 必须精确引用合法匹配结果中某应用的 ID；本文件 `DEMO-TEMPLATE-A`                                    |
| `packageName`          | string，沿用 match v1 的小写 `dev.mtx.demo.*` 包名段规则        | 必须同时等于该匹配应用的完整包名；本文件 `dev.mtx.demo.pay.a`                                      |
| `status`               | string，固定 `submitted`                                        | 仅此独立协议的提交展示状态                                                                         |
| `formType`             | string，固定 `form`                                             | 页面显示「合成表单」                                                                               |
| `submittedAt`          | string，规范 `YYYY-MM-DDTHH:mm:ssZ`                             | 必须是真实有效日期 / 时间且转回规范 UTC 字符串完全一致；不接受时区偏移、毫秒或自动归一化的非法日期 |
| `fields`               | object[]，一至二项                                              | 每项种类唯一；对象不可为 null 或数组                                                               |
| `fields[].kind`        | `password` / `pin`                                              | 两种合成展示字段，不扩展任意输入                                                                   |
| `fields[].label`       | `password` 对应「密码」；`pin` 对应「PIN」                      | 必须与种类精确配对                                                                                 |
| `fields[].sampleValue` | string，仅 `000000` / `111111` / `222222` / `333333`            | 固定虚构值；保留字符串，不接受数字类型、任意正文或真实凭证                                         |
| `synthetic`            | boolean，`true`                                                 | 每条提交记录单独声明合成标记                                                                       |

附加字段忽略，不作为表单正文透传；记录白名单仅保留上表字段，嵌套字段仅保留 `kind`、`label`、`sampleValue`。校验及界面分别建立副本，不修改导入 JSON、父组件对象或真实记录。密码 / PIN 用文本插值显示，不执行 HTML、模板或脚本。

### 完整固定 JSON 示例

以下为当前提交 fixture 的完整内容。所有标识与两个 `000000` 都是固定假值；它只关联已匹配的样例支付 A，不属于手机报告：

```json
{
    "protocol": "mtx-injection-submission-demo/v1",
    "datasetId": "DEMO-DEVICE-01",
    "schemaVersion": 1,
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "description": "固定虚构表单：只叠加到已匹配的合成应用，密码和 PIN 均为预设样例，不接收设备数据。",
    "records": [
        {
            "id": "DEMO-SUBMISSION-A",
            "applicationId": "DEMO-TEMPLATE-A",
            "packageName": "dev.mtx.demo.pay.a",
            "status": "submitted",
            "formType": "form",
            "submittedAt": "2026-01-01T09:40:00Z",
            "fields": [
                {
                    "kind": "password",
                    "label": "密码",
                    "sampleValue": "000000"
                },
                {
                    "kind": "pin",
                    "label": "PIN",
                    "sampleValue": "000000"
                }
            ],
            "synthetic": true
        }
    ]
}
```

### 关联结果与失败规则

`attachInjectionSubmissions(matchResult, fixture)` 先校验合法的 match v1 结果：三个计数是 0–100 的安全整数，应用数组长度等于 `matchedCount`，交集不大于全局 / 已安装数，应用标记、唯一 ID / 包名、名称、基础状态、时间、跳过值及原 DEMO 字段均符合 match v1。随后校验整份提交 fixture；每条提交的 `applicationId` 与 `packageName` 必须同时精确关联到已有匹配应用，未匹配项不能通过单独提供一条提交记录进入展示。

有效关联结果保留 `protocol:mtx-injection-match-demo/v1` 和 `registryCount` / `installedCount` / `matchedCount`，另外添加 `submissionProtocol:mtx-injection-submission-demo/v1` 与 `submittedCount`。后者是合法提交记录数量；当前固定结果为全局 6、已安装 6、匹配 4、提交 1。每个应用增加 `submission`：有记录时为独立白名单副本，没有记录时为 `null`。关联项的展示状态为 `submitted`、`skip:false`，原基础 `fields` 保留，不把密码 / PIN 写进 match v1 的 DEMO 字段格式。

任一 match 结果非法、任一提交字段非法、ID / 引用 / 包名重复、时间不规范或引用不一致，都使关联结果整份失败：`valid:false`、四个计数均零、`applications:[]`，同时带两个协议标识；不保留部分坏记录。提交 `records:[]` 则有效，`submittedCount:0`，原匹配四项与基础状态保留。`submitted` 不加入 match v1 的 `applicationStates` 枚举；两份原 JSON 保持分离，每次使用原合法匹配结果叠加提交展示层。

### 默认展示与本地状态

- sample 来源仍须先通过当前账号 / 设备 / `templates` 分区的有效鉴权空态 GET；等待、失败、非法响应或上下文切换隐藏旧数据，其他来源默认关闭、校验后手动展示。新提交文件不替代接口空态。
- 默认 A 为绿色「已提交 (示例)」并展开「注入内容 (示例)」，显示「合成表单」、固定 UTC 提交时间和密码 / PIN `000000`。B / C 跳过、D 已注入三卡默认折叠；D 的 `DEMO-D001` / `DEMO-D002` 来自原匹配 JSON，未删除或替换。
- 快捷窗标题默认「已提交 1/4」，分母是四个匹配应用；来源行仍显示「全局 6 · 已安装 6 · 匹配 4」。组件按当前局部 `status === 'submitted'` 统计并更新标题；跳过 A 后为 0/4，取消跳过恢复 1/4。无提交记录的卡片取消跳过只成为本地已注入，不增加提交数量。
- 「打开」仅展开当前合成详情；「跳过」仅切换局部状态，不发送字段；单项 / 全部「重置预览」从固定 JSON 副本恢复原状态，包括 A 已提交并展开、其他三卡折叠。不会改写两份 fixture、全局列表或父组件对象。
- 此次仅为本地合成 UI 展示，不实现设备表单捕获、密码读取、注入、设备下发、网络提交或持久化，不增加命令、API 或 WS 消息。十个预览 GET 的空数据与九个预览 POST 的 501 / `dispatched:false` 保持不变。

## 全栏目协议矩阵与准备数量（2026-10-11）

本轮准备的是十一份静态 JSON 合同与本地合成展示，不是十一项设备能力。文件统一位于 `frontend/src/fixtures/`，共同顶层包含 `protocol`、`schemaVersion:1`、`datasetId:"DEMO-DEVICE-01"`、`source:"synthetic-ui-fixture"`、`fixtureOnly:true`。`datasetId` 只关联虚构数据集，不代替 HTTP 的设备编号、账号隔离、设备 JWT 或查看租约。

### 应用列表目标与条件按钮（2026-10-11 修订）

`frontend/src/fixtures/apps-demo-presentation.js` 是纯本地展示投影，不是新增 JSON / 设备传输协议。它复用 apps、match、submission 三份 v1 合同及读取器，核对用户安装报告与应用目录非系统包名集合完全一致、全局条目与同包名目录身份一致，再按完整包名合并匹配及提交状态；任一合同 / 关联非法时整份模型为空。输入文件不被改写，原 `group` 常用 / 系统字段保留。

固定数量分开计算：目录已安装 8（用户 6 / 系统 2）、全局配置 6（启用 5）、目标交集 4、普通用户 2、启用未安装配置 1。系统开关和搜索只改变可见行数；不能把默认可见 6 条称为匹配 6。未安装 E 不计入安装或目标交集，禁用 F 和未配置 G 不显示为注入目标。

| 派生分组 / 状态    | 固定样例                                    | 条件展示按钮                             |
| ------------------ | ------------------------------------------- | ---------------------------------------- |
| target / submitted | A，已提交                                   | 打开、弹窗、横幅、注入、重注、卸载       |
| target / injected  | D，已注入                                   | 打开、弹窗、横幅、注入、重注、卸载       |
| target / skipped   | B / C，列表投影为注入目标；快捷窗仍为已跳过 | 打开、弹窗、横幅、注入、卸载；不显示重注 |
| ordinary / sample  | F / G，已安装                               | 打开、卸载                               |
| system / sample    | 系统设置 / 桌面                             | 打开                                     |
| configured，未安装 | E                                           | 无按钮，只读说明                         |

派生 `presentationGroup`、`matchStatus`、`statusLabel`、`actions:{id,label,tone}[]` 与 `counts:{installed,user,system,matched,ordinary,configured,registry,enabled}` 只用于组件，不写回任何 fixture，不是新的 wire 字段。所有按钮仅显示本地合成反馈，不改变状态、不持久化、不发设备指令，也不改变后端空态 GET / 501 POST。展示中的「注入 / 重注 / 卸载」不是已实现的设备动作。

### 已准备的固定文件

| 栏目 / 浮窗         | 文件                                    | 独立协议                           | 固定集合与数量                                                        | 初始展示与鉴权入口                                                                                  |
| ------------------- | --------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 应用列表            | `device-apps-demo.json`                 | `mtx-apps-demo/v1`                 | `applications` 八项：六用户 / 两系统                                  | `ui-preview/apps` 严格空态 GET 后，sample 默认六用户；系统筛选显示八项，其他来源手动                |
| 短信记录            | `device-sms-demo.json`                  | `mtx-sms-demo/v1`                  | `messages` 八条                                                       | `ui-preview/sms` 严格空态 GET 后，sample 默认展示，其他来源手动                                     |
| 密码记录            | `device-records-demo.json`              | `mtx-records-demo/v1`              | `records` 24 条，APP 14 / 键盘 9 / PIN 1；三个应用来源                | `ui-preview/password` 严格空态 GET 后，sample 默认展示，其他来源手动                                |
| 支付密码            | `device-payments-demo.json`             | `mtx-payments-demo/v1`             | `applications` 四项，`records` 24 条，分布 12 / 5 / 4 / 3             | `ui-preview/payments` 严格空态 GET 后，sample 默认展示，其他来源手动                                |
| 注入记录            | `device-injection-records-demo.json`    | `mtx-injection-records-demo/v1`    | `applications` 三项，`records` 六条，每条两字段                       | `ui-preview/templates` 严格空态 GET 后，sample 默认展示，其他来源手动                               |
| 锁屏密码            | `device-ui-demo.json`                   | `mtx-ui-demo/v1`                   | `lockEvents` 十六条；旧 `applications` 两项保留兼容、不用于当前快捷窗 | 固定 password 浮窗严格空态 GET 后，sample 默认首条 PIN，其余来源手动；保留上文类型及复制规则        |
| 全局列表 / 快捷匹配 | `device-injection-match-demo.json`      | `mtx-injection-match-demo/v1`      | 全局六项 / 启用五项，安装报告六项，状态六项；精确交集四项             | 全局页各角色只读六行；快捷窗 templates 严格空态 GET 后，sample 默认四卡                             |
| 快捷提交展示层      | `device-injection-submission-demo.json` | `mtx-injection-submission-demo/v1` | `records` 一条，密码 / PIN 两字段                                     | 关联合法匹配四卡，A 默认绿色展开；标题已提交 1/4；其他来源手动                                      |
| 相册图片            | `device-gallery-demo.json`              | `mtx-gallery-demo/v1`              | `items` 两张，仓库自制 SVG                                            | 所有来源默认关闭；gallery 严格空态 GET 后可手动测试数据                                             |
| AI 金融分析样例     | `device-analysis-demo.json`             | `mtx-analysis-demo/v1`             | `items` 两项固定摘要，引用八条短信的 ID                               | 所有来源默认关闭；analysis 严格空态 GET 后可手动测试数据，不调用 AI                                 |
| 备忘录只读样例      | `device-memos-demo.json`                | `mtx-memos-demo/v1`                | `items` 两条                                                          | 所有来源默认关闭；原 `/api/devices/:id/memos` 鉴权 GET 校验成功后可手动测试数据，不要求真实备忘为空 |

数量取自仓库文件，不是设备 API 的 `total`。支付的成功样例共 23 条；三个统计块根据选中应用分别计算总条数、`success:true` 数量和不同 `value` 数量，不能套用参考截图中的统计数字。关闭样例或等待 / 失败时不保留上一上下文的展示；手动刷新保留有效上下文中的开关选择。

工具箱九个目录项沿用 `backend/src/device-ui-preview.js` 的元数据，动作真实返回 HTTP 501 / `dispatched:false`，没有假执行结果。截图、阅读器、节点与 API 调试沿用原截图 / 节点 fixture、`DEVICE_API.md`、`SCREEN_CAPTURE_PROTOCOL.md` 等既有合同，不计入上述十一份 JSON，也不因样例矩阵增加手机指令。备忘录原 CRUD 与上述只读样例是两个数据区，样例卡没有编辑、删除或保存入口。

### 同一合成应用目录与关联键

| 目录编号      | 名称           | 完整包名                       | 用户 / 系统 | 本地假数据关联                           |
| ------------- | -------------- | ------------------------------ | ----------- | ---------------------------------------- |
| `DEMO-APP-01` | 样例支付 A     | `dev.mtx.demo.pay.a`           | 用户        | 匹配 A、提交 A、支付、密码记录、注入记录 |
| `DEMO-APP-02` | 样例钱包 B     | `dev.mtx.demo.wallet.b`        | 用户        | 匹配 B、支付、密码记录、注入记录         |
| `DEMO-APP-03` | 样例银行 C     | `dev.mtx.demo.bank.c`          | 用户        | 匹配 C                                   |
| `DEMO-APP-04` | 样例应用 D     | `dev.mtx.demo.app.d`           | 用户        | 匹配 D、注入记录                         |
| `DEMO-APP-05` | 样例助手 F     | `dev.mtx.demo.helper.f`        | 用户        | 安装报告含 F，但全局停用而不匹配         |
| `DEMO-APP-06` | 样例普通应用 G | `dev.mtx.demo.unlisted.g`      | 用户        | 安装报告含 G，但未列入全局而不匹配       |
| `DEMO-APP-07` | 样例系统设置   | `dev.mtx.demo.system.settings` | 系统        | 支付、密码记录；不计入安装报告六用户     |
| `DEMO-APP-08` | 样例系统桌面   | `dev.mtx.demo.system.launcher` | 系统        | 支付；不计入安装报告六用户               |

全局 E `dev.mtx.demo.shop.e` 是未安装模板，不是目录应用。应用页从已验证全局列表派生「已配置未安装」E 一行（`.app-configured-row`），仅作模板说明；它不加入应用目录、不计入六用户 / 八总数、不进入已安装报告或四项交集。锁屏 `source` 的 `dev.mtx.demo.system`、`dev.mtx.demo.app1` / `app2` / `app3`、`dev.mtx.demo.scene` 是保留的虚构 legacy 组件来源标签，不是应用 catalog 关联键；旧两项兼容应用不参与新目录匹配。主密码记录的三个来源实际为 A / B / 系统设置，注入记录为 A / B / D，支付为系统设置 / A / B / 系统桌面。

各模块 ID 有意保留自己的命名空间。支付 `records[].appId` 引用本文件 `applications[].id`；注入记录 `records[].applicationId` 引用本文件应用 ID；快捷提交 `applicationId` 引用匹配结果中的 `DEMO-TEMPLATE-*`。跨模块用完整 `packageName` 精确关联，不把 `DEMO-APP-*`、`DEMO-PAY-APP-*`、`DEMO-INJECTION-APP-*` 和 `DEMO-TEMPLATE-*` 强行合并。密码记录、支付和注入记录页面显式将应用目录传给各自 reader，要求名称和完整包名同时精确匹配合法目录；这些 reader 的单参数兼容调用只检查模块自身合同，不执行额外目录关联。分析的 `messageIds` 引用同数据集短信 ID，不接收任意正文；实际页面将短信 fixture 显式传入 `readAnalysisDemo` 做外键校验，单参数兼容模式只允许原八个固定短信 ID。

### 共享 reader 与共同字段

`frontend/src/fixtures/device-fixture-protocol.js` 集中八个主画布协议常量、数据集常量、顶层合同、日期与列表检查，各组件读取静态文件后构建字段白名单副本。锁屏入口同文件的 `readLockDemo` 先做整份校验，再由专用 typed 值 / 图案 helper 与子组件保留上文后备行为；匹配和提交继续使用各自专用 helper，三者同时复用共同顶层 envelope。与服务器 GET 的权限 / 当前上下文验证分离，静态标记本身不是访问授权。

| 字段 / 检查   | 八个主画布模块的约定                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 顶层          | 必须为非空、非数组对象；`protocol` 严格等于所属模块常量，其余固定标记 / `datasetId` 严格匹配；`description` 为说明，不进入展示记录                                 |
| 集合          | 数组，0–100 项；空数组有效；每项为非空、非数组对象                                                                                                                 |
| `id`          | 非空字符串，长度最多 64，`DEMO-` 后仅大写字母、数字、下划线、连字符；同一集合内唯一                                                                                |
| `synthetic`   | 每项必须为布尔 `true`，不接受字符串标记                                                                                                                            |
| `packageName` | 最多 150 字符，固定 `dev.mtx.demo.` 前缀；每个后续段以小写字母开头，仅小写字母、数字或下划线；按模块关联应用                                                       |
| 样例名称      | 应用 `name`、相册 `title`、备忘作者为「样例」前缀，长度最多 60                                                                                                     |
| 固定标签值    | 地址、支付 `value` 为最多 80 字符的 `DEMO-` 标签，后缀同 ID 字符白名单；注入历史记录的 `password` / `PIN` 值固定为四位数字合成样例；其它模块不接收任意数值或凭证   |
| 日期          | `YYYY-MM-DDTHH:mm:ssZ` 或带 `±HH:mm` 时区偏移，无毫秒；年份 2000–2099，有效月 / 日（含闰年）及 00–23 / 00–59 / 00–59；偏移不大于 14:00，14 小时偏移的分钟必须为 00 |
| 失败与副本    | envelope、任一行、唯一性、类型、日期或外键非法时整份 `valid:false` / 对应数组为空；未知额外字段忽略，不透传；嵌套 `fields` / `messageIds` 均复制                   |

上述日历日期规则属于八个主画布 reader；锁屏入口 `readLockDemo` 单独检查有范围的 `HH:mm:ss`，match 仍检查 `MM/DD HH:mm` 格式，submission 必须规范 UTC。

`readLockDemo(fixture)` 严格校验 `mtx-ui-demo/v1` 共同 envelope 与 `lockEvents` 数组（0–100 条，ID 唯一、DEMO 编号和 `synthetic:true`），每行 `category` 仅 system / scenario / app、label 一至 24 字、source 合法虚构包名格式、time 有效小时 / 分 / 秒、valueType 四枚举、sampleValue 符合固定类型白名单。pattern 类型必须具有二至九个不重复 1–9 点；非 pattern 类型不得携带 pattern 字段。任一行非法整份 `valid:false` / `lockEvents:[]`；有效时仅复制锁屏展示白名单，图案数组独立复制，旧 applications 不作为当前锁屏或快捷数据。子组件直接收到非法记录时的 `DEMO-UNSET` / 过滤仍是后备防御；正常 fixture 不靠逐行降级继续展示。复制 payload 的旧字段与不带 datasetId 的兼容约定不变。

### 主画布逐字段矩阵

每个集合元素共同含 `id` 与 `synthetic:true`；下表列出其他全部展示字段。未列字段不进入白名单副本。

| 协议 / 集合                        | 字段                                                                   | 类型、枚举与关联                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps / `applications`              | `name`, `packageName`, `initial`, `system`, `group`                    | 名称 / 包名按共同规则；`initial` 一至二字符；`system` 严格布尔；`group` 必须与 system 配对为「系统应用」或「常用应用」；ID / 包名各自唯一                              |
| sms / `messages`                   | `sender`, `address`, `body`, `receivedAt`                              | sender 一至 30 字；address 固定 DEMO 标签；body 一至 500 字且以「【合成测试】」开头；receivedAt 使用共享有效日期                                                       |
| records / `records`                | `type`, `typeLabel`, `content`, `appName`, `packageName`, `occurredAt` | type 仅 app / keyboard / pin，标签精确 APP / 键盘 / PIN；content 一至 500 字且以 DEMO- 开头；appName / 包名为目录假应用，occurredAt 有效日期                           |
| payments / `applications`          | `name`, `packageName`, `ageLabel`                                      | 名称 / 包名为目录假应用；ageLabel 一至 40 字的固定相对时间展示，不计算真实手机最近活动；ID / 包名各自唯一                                                              |
| payments / `records`               | `appId`, `value`, `kind`, `occurredAt`, `success`                      | appId 必须引用本文件合法应用；value 固定 DEMO 标签；kind 固定「APP密码」；occurredAt 有效日期；success 严格布尔，仅样例状态                                            |
| injection-records / `applications` | `name`, `packageName`, `initial`, `status`                             | 目录假应用 / 一至二字符图标；status 固定 submitted，仅合成历史展示；ID / 包名各自唯一                                                                                  |
| injection-records / `records`      | `applicationId`, `occurredAt`, `fields`                                | 本文件应用外键；occurredAt 有效日期；fields 正好两项、每项非空非数组对象；标签集合必须是 `password` 与 `PIN` 且不重复，value 必须匹配 `^\d{4}$`，例如 `password: 9519` |
| gallery / `items`                  | `title`, `assetId`, `mimeType`, `width`, `height`, `createdAt`         | title 样例前缀；assetId 仅 landscape / geometry 且唯一；mimeType 固定 image/svg+xml；width / height 严格为 320 / 180；createdAt 有效日期                               |
| analysis / `items`                 | `title`, `summary`, `messageIds`                                       | title 一至 40 字；summary 一至 500 字且以「【合成测试】」开头；messageIds 一至 100 项且唯一，每项必须引用合法固定短信 ID                                               |
| memos / `items`                    | `body`, `label`, `author`, `createdAt`, `updatedAt`                    | body 一至 500 字且以「【合成测试】」开头；label 仅 none / important / follow_up / handled；author 样例前缀；两时间均有效且 updatedAt 不早于 createdAt                  |

主画布记录、短信与新的摘要均以 Vue 文本插值呈现，包括 `<b>示例</b>` 转义测试，不解释为 HTML 或模板。相册 JSON 不接受图片 URL、文件路径或 base64；页面只将两个白名单 `assetId` 映射到仓库自制 SVG，经显式 `?url&no-inline` 导入后由 Vite 打包为同源 `/assets/gallery-landscape-<hash>.svg` 与 `/assets/gallery-geometry-<hash>.svg`。`publicDir` 仍为 `false`，不依赖 `/demo` 静态路由，也没有外部图片、手机文件路径或上传步骤。

### 三个补齐模块的完整 JSON

以下三份 JSON 直接对应当前仓库文件；界面须标注固定合成来源，默认关闭，鉴权通过后由「测试数据」手动展示。相册不采集手机相册；分析只显示固定摘要与短信 ID 关联、不调用模型；备忘样例只读、不进入既有 CRUD。它们不是服务器成功回执。

#### 相册图片

`device-gallery-demo.json`：

```json
{
    "protocol": "mtx-gallery-demo/v1",
    "schemaVersion": 1,
    "datasetId": "DEMO-DEVICE-01",
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "description": "固定合成测试样本，仅本地展示；不代表设备记录。",
    "items": [
        {
            "id": "DEMO-GALLERY-01",
            "title": "样例山景",
            "assetId": "landscape",
            "mimeType": "image/svg+xml",
            "width": 320,
            "height": 180,
            "createdAt": "2026-10-10T10:10:00+08:00",
            "synthetic": true
        },
        {
            "id": "DEMO-GALLERY-02",
            "title": "样例几何",
            "assetId": "geometry",
            "mimeType": "image/svg+xml",
            "width": 320,
            "height": 180,
            "createdAt": "2026-10-10T10:05:00+08:00",
            "synthetic": true
        }
    ]
}
```

#### AI 金融分析固定摘要

`device-analysis-demo.json`：

```json
{
    "protocol": "mtx-analysis-demo/v1",
    "schemaVersion": 1,
    "datasetId": "DEMO-DEVICE-01",
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "description": "固定合成测试样本，仅本地展示；不代表设备记录。",
    "items": [
        {
            "id": "DEMO-ANALYSIS-01",
            "title": "短信样例统计",
            "summary": "【合成测试】固定样本包含 8 条短信；这里只展示预设汇总，不调用 AI。",
            "messageIds": [
                "DEMO-SMS-01",
                "DEMO-SMS-02",
                "DEMO-SMS-03",
                "DEMO-SMS-04",
                "DEMO-SMS-05",
                "DEMO-SMS-06",
                "DEMO-SMS-07",
                "DEMO-SMS-08"
            ],
            "synthetic": true
        },
        {
            "id": "DEMO-ANALYSIS-02",
            "title": "账单样例摘要",
            "summary": "【合成测试】演示账单为 128.00 测试单位，仅用于布局核对。",
            "messageIds": ["DEMO-SMS-02"],
            "synthetic": true
        }
    ]
}
```

#### 备忘录只读样例

`device-memos-demo.json`：

```json
{
    "protocol": "mtx-memos-demo/v1",
    "schemaVersion": 1,
    "datasetId": "DEMO-DEVICE-01",
    "source": "synthetic-ui-fixture",
    "fixtureOnly": true,
    "description": "固定合成测试样本，仅本地展示；不代表设备记录。",
    "items": [
        {
            "id": "DEMO-MEMO-01",
            "body": "【合成测试】核对短信、应用与密码样本协议。",
            "label": "follow_up",
            "author": "样例研究员",
            "createdAt": "2026-10-10T10:00:00+08:00",
            "updatedAt": "2026-10-10T10:10:00+08:00",
            "synthetic": true
        },
        {
            "id": "DEMO-MEMO-02",
            "body": "【合成测试】只读样例与真实备忘录分开展示。",
            "label": "handled",
            "author": "样例研究员",
            "createdAt": "2026-10-10T09:00:00+08:00",
            "updatedAt": "2026-10-10T09:10:00+08:00",
            "synthetic": true
        }
    ]
}
```
