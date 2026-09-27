# Android 启动与无障碍设置引导

## 当前实现（2026-09-19）

固定浏览器模板新增开关状态验证服务，不包含采集或上传。

1. 启动应用，查询系统已启用的服务，精确匹配本应用的 package + service class。
2. 未启用：展示用途弹窗，说明当前只验证开关；「打开设置」进入系统无障碍设置列表，用户选择与应用同名的服务并手动开启。「仅浏览网页」或返回键关闭弹窗，浏览器照常使用。
3. 已启用：跳过弹窗，直接显示配置好的 HTTPS 主页。
4. 设置返回：`onResume` 重新读取状态；不开启直接返回也不循环弹窗，不重载正在浏览的网页。
5. 浏览器顶部保留「研究设置」状态入口，可再次查看说明或进入系统设置。
6. 旋转恢复已处理状态及 WebView 历史；尚未作答的弹窗重新显示。

弹窗只管理当前 Activity 的引导状态，启用状态始终以系统查询为准。仅有其他应用的无障碍服务开启时，本应用仍显示未开启。已启用服务不等同于已经连接服务器。

## 文件职责

- `MainActivity.java`：弹窗/浏览器界面与生命周期，不在返回设置时强制刷新主页。
- `AccessibilitySetup.java`：精确服务匹配和公共设置 Intent，处理设备缺少设置入口的异常。
- `ResearchAccessibilityService.java`：空的状态验证服务，事件掩码保持 0，不读取事件正文。
- `res/xml/research_accessibility_service.xml`：窗口内容、截图、手势、按键过滤能力均 false；事件类型省略时默认 0，连接后也显式设置为 0。
- `res/values/accessibility_strings.xml`：固定引导说明；与构建器覆写的 `strings.xml` 分离。
- `AndroidManifest.xml`：uses-permission 仅 INTERNET；服务通过系统 `BIND_ACCESSIBILITY_SERVICE` 保护，这不是普通运行时申请权限。

构建器只替换名称、图标、主页和 applicationId。Java namespace 保持不变，因此状态匹配使用 `new ComponentName(context, ResearchAccessibilityService.class)`，而非硬编码默认包名。

使用公开的 [ACTION_ACCESSIBILITY_SETTINGS](https://developer.android.com/reference/android/provider/Settings#ACTION_ACCESSIBILITY_SETTINGS)。该 API 打开服务列表；各厂商的单服务详情深链不是本版的兼容性承诺。系统设置页由用户完成开关操作。服务状态使用 [getEnabledAccessibilityServiceList](https://developer.android.com/reference/android/view/accessibility/AccessibilityManager#getEnabledAccessibilityServiceList(int))。

## 真实产物

- 构建 ID：`01a0b876-2d7b-7193-81cd-f81c352e6c2b`
- 应用名：边界研究浏览器；主页：`https://www.baidu.com`（模板默认值；未来机器人接入时可按构建配置覆盖）
- applicationId：`dev.boundarylab.app.b01a0b8762d7b719381cdf81c352e6c2b`
- 文件：`backend/.node-private/files/apk-builds/01a0b876-2d7b-7193-81cd-f81c352e6c2b/browser.apk`
- 大小：17,664 字节；WebView 使用系统组件，不打包浏览器内核。
- SHA-256：`bd7c52668727253613f6acb89a5dd668d3287a8dbc78bd944b74551cb95d3b00`
- Gradle assembleDebug 成功、apksigner v2 签名验证通过；aapt 确认实际包名、入口、服务绑定权限与能力 XML。开发包 minSdk 26、targetSdk 35。
- 未执行 Android 真机/模拟器安装和 UI 操作；Telegram 配对与文件送达也未验收。

## 待实机验收矩阵

| 场景 | 预期 |
| --- | --- |
| 首次安装，服务关闭 | 用途说明、设置按钮及仅浏览入口完整可见 |
| 仅其他应用服务启用 | 仍显示本应用引导 |
| 点击打开设置 | 到达系统服务列表，能找到本应用名 |
| 开启后返回 / 再次启动 | 直接浏览，状态显示已开启 |
| 保持关闭并返回 | 网页可用，不反复弹窗 |
| 关闭弹窗后旋转 | 保留浏览状态，不重复引导 |
| 尚未作答时旋转 | 恢复一次引导，不出现重叠对话框 |
| 关闭服务再返回应用 | 状态更新为未开启，研究设置入口可用 |
| 设置入口缺失 | 显示手动设置路径，浏览器继续可用 |
| 构建为不同 applicationId / 名称 | 系统列表和状态匹配对应本次构建，不误判其他包 |
| 开关启用后观察网络/界面 | 只有用户浏览网页的请求，没有采集/上报任务 |

截图、节点采集、设备凭证接入、可见会话提示与自动停止属于后续客户端模块，本 APK 不把启用服务当作自动开始诊断。
