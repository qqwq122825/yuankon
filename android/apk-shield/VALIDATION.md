# APK Shield 验证记录 · 2026-09-24

## 实际 APK 构建

不是模拟构建文件；两项均实际执行编译、DEX 认证加密、重打包和签名。

| 样本 | 实际结果 |
| --- | --- |
| 纯浏览器 `com.mtx.test` / 4.0 / 1711397954 | 成功；最低系统从 API 26 显式升至 29，targetSdk 35 保留；输出 37,660 字节 |
| 独立状态服务样本 `com.mtx.shield.statusdemo` / 1.0 / 1 | 成功；自定义 `DemoApplication` 和无障碍状态服务保留，API 29/35 保留；输出 45,908 字节 |

两份新构建报告均记录 19 个通过的阶段，包含：

- Manifest 除组件工厂和明确选择的 minSdk 调整外保持一致。
- 原资源及服务 XML 字节哈希一致。
- 输出 APK 的签名和 ZIP 对齐检查通过。
- 从输出 APK 重新读取密文，使用与 Android 相同的解码代码完成往返校验。
- 原输入文件未改动。

状态服务样本来自 `android-shell` 的隔离副本，仅在该副本加入不增加功能的 `DemoApplication`、改为独立测试包名、将 minSdk 设为 29；Release 构建和 Android Lint 均通过。原模板保持不变。样本只申请 INTERNET，状态服务受系统 BIND_ACCESSIBILITY_SERVICE 绑定权限保护，XML 的事件/flags 缺省为零、各读取和控制能力为 false。

本地结果：

```text
apk-shield/output/com.mtx.test-1711397954-shield-20260924-084911-729830d9.apk
apk-shield/output/com.mtx.shield.statusdemo-1-shield-20260924-084913-5386a276.apk
```

同名 `.json` 为完整校验报告。中途存在一次针对资源缩短路径 `res/xh.xml` 的预检失败；已修复为按资源表中的 XML 类型映射并验证所有变体，原失败日志保留以供诊断，不清空历史记录。

## 自动化验证的含义

61 个加壳工具 Python/JVM 测试、12 个原 repack 测试通过。涵盖结构校验、服务能力边界、多资源配置、日志脱敏、错误与超时、签名以外文件守恒、AES-GCM 篡改失败、默认/AndroidX 工厂委托。桌面 Android API stub 只验证分发代码，不运行 Android ART。

真实 CLI 错误路径也已验证：原浏览器未选择提高 minSdk 时在 `compatibility` 阶段停止，失败报告保留包名与原 SDK 值；缺少配置文件时在 `configuration` 阶段生成失败报告。两项均退出码 1，没有生成 APK。

后端回归：67 个 PHPUnit 测试、584 个断言通过；Pint、Blade 编译通过。本轮没有修改网页布局，因此未新增网页交互验收结论。

## 尚未完成

- 当前 ADB 无已连接设备，本机未配置模拟器；**两份输出均未在 Android 设备安装/启动**。
- 无障碍系统开关、服务绑定、后台切换恢复、WebView 加载、不同 Android 版本兼容性与性能仍待实机测试。
- 无障碍检查属于静态声明检查，不证明其他输入 APK 的完整运行行为。
- 加壳不保证防破解；本原型密钥随 APK 分发且可被提取。

所有构建报告保留 `runtime_tested: false`。只读设备日志脚本也不会把“收集到日志”标记为“功能验收通过”。
