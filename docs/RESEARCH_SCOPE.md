# 无障碍边界研究范围

## 项目定位
本项目定位为合法、合规的安全研究工具，用于观察 Android 在不同机型、系统版本和界面实现下暴露的无障碍结构。主要产出是可复核的实验记录，而非真实用户凭证或私人通信内容。

研究用途要体现为实际工程约束：明确登记测试设备、限定实验范围、知情参与、使用虚构数据、最小化保留、控制访问、设置删除周期。用途说明本身不替代这些措施，也不对任意后续使用作法律结论。

## 包含的研究场景
1. 常规节点：类名、资源 ID、父子关系、坐标、可见性、可交互属性。
2. 密码字段：是否发生文本变化事件、是否设置 isPassword、敏感标记是否存在、是否返回文本、是否匹配预设虚构值。
3. 短信测试：研究者发送的虚构消息在短信界面、无障碍通知事件、通知监听通道和短信权限通道中的可见性。四类通道分别记录。
4. 生命周期：最近任务移除、系统回收、强行停止、重启、首次解锁前后分别建立实验。

## 记录方式
- 密码和短信内容先在采集端与虚构测试值比较，后台仅保留事件元数据与匹配结果。
- 真实密码、验证码、私人短信正文和相应散列不作为研究日志字段。
- 截图由研究者主动导入；先检查并遮蔽敏感内容。本版图片处理仅剥离文件元数据，不进行内容识别。
- 空节点、未收到事件、未上传成功、服务断开是不同现象；避免从单一空结果推出全部系统行为。
- 机型、Android 版本、应用版本、测试用例、服务配置、权限组合、锁屏/解锁状态和测试时点都应纳入后续实机实验记录。
- 预置示例只是验证页面，不是对某型号手机作出的研究结论。

## 当前能力边界
首版是本机研究查看器，展示示例及既有研究记录。手动导入页面与上传路由已按用户要求移除。已有真实浏览器 APK 构建及无障碍开关引导，服务端具备有凭证的诊断会话/临时帧接收接口。尚未实现手机采集端、实时读取、短信读取、密码事件监听或设备操作；API 联调测试不等同于真机采集。
密码/短信观察表只是接收并展示合成场景元数据的协议和 UI，不产生采集能力。

## 技术依据
- [AccessibilityService 生命周期与窗口读取](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [AccessibilityEvent 事件属性](https://developer.android.com/reference/android/view/accessibility/AccessibilityEvent)
- [AccessibilityNodeInfo 节点属性](https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo)
- [READ_SMS 权限](https://developer.android.com/reference/android/Manifest.permission#READ_SMS)

开启无障碍与取得 READ_SMS 是不同事项；读到短信应用当前暴露的界面，也不等同于取得短信数据库全部历史记录。
