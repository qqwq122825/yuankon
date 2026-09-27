# APK Shield 0.1 · 本地加壳原型

这是实际包含 **DEX 加密、启动加载器、二进制 Manifest 修改、APK 重组与签名** 的第一版引擎，不是把重新签名称为加壳。直接处理成品 APK，不读取应用源码；构建加载器时会编译本目录内的引擎源码。

**当前定位是浏览器及无障碍状态验证应用的原型，不是全 APK 通用或商业级保护工具。** 已并行补充启动兼容、结构预检、日志与测试；仍根据真实设备测试逐步扩大兼容范围。

## 快速使用

1. 将原始 APK 放进本目录的 `input/`。
2. 双击 `run.command`，或在本目录运行 `python3 engine.py`。
3. `output/` 输出新的 APK、JSON 校验报告和日志；输入不改动、不上传。

**5412ce7f 扫描实验交付包**（加壳 + 去掉样本 `resources.arsc`，见实测 **docs/SHIELD_DELIVERY.md**）：

```bash
python3 build_delivery.py
# → output/delivery/5412ce7f-shield-delivery.apk
```

仅使用 Android 10+ 的公开 API。如果原包最低版本低于 Android 10，默认停止并提示；确认舍弃更低系统版本后，在本目录运行：

```bash
python3 engine.py --allow-min-sdk-raise
# 或先做结构预检，不生成 APK
python3 engine.py --check-only --allow-min-sdk-raise /绝对路径/应用.apk
```

也可以在 `config.json` 中将 `allow_min_sdk_raise` 设置成 `true`，之后双击运行。包名、版本名、构建号、主页不变。最低系统版本只会提高到 API 29，不会降低更高的原始要求；targetSdk 原样保留。

`config.json` 的 `compatibility_profile` 默认为 `browser`（仅 INTERNET、无 Receiver/Provider、无 JNI）。对含 `lib/*/*.so`、常规权限与 AndroidX/Firebase 组件的成品包，设为 `embedded-native`；该模式不静态审核无障碍 XML 与权限集合，设备运行仍需自行验证。命令行可用 `--compatibility-profile embedded-native` 临时覆盖。

**安装扫描对比（仅研究调试）**：`manifest_debug` 可在加壳时从二进制 Manifest **剥离 `uses-permission` / 自定义 `<permission>`**（DEX 与组件不变）。输出 APK 文件名带 `-permdebug`，JSON 报告含 `manifest_debug.removed` 列表。默认对 `5412ce7f` 启用 `remove_all` 以便先判断「安装提示是否仍出现」。若仍提示，多半不是 Manifest 权限列表单独导致（还可能看签名、壳、组件、包名信誉）。剥离后应用可能因缺权限无法正常运行，勿当作正式包。

```bash
python3 engine.py --list-permissions input/5412ce7f.apk
python3 engine.py --no-manifest-debug input/5412ce7f.apk
python3 engine.py --manifest-debug-mode keep_only --manifest-debug-permissions android.permission.INTERNET input/5412ce7f.apk
```

## 首版支持范围

- 独立、非 debuggable、Java/Kotlin 编译到 DEX 的普通 Activity 应用；有 MAIN/LAUNCHER 入口。
- Android 10 / API 29 及以上；targetSdk 至少 29。
- 权限只接受 INTERNET 或空集合，与当前浏览器项目保持一致。
- 默认或自定义 Application，保留原 Application 类及初始化入口。
- 默认组件工厂或 `androidx.core.app.CoreComponentFactory` 委托；后者有桌面分发测试，Android 设备兼容性仍待验证。
- 已声明的无障碍**状态验证服务**：BIND_ACCESSIBILITY_SERVICE 绑定保护、事件掩码/flags 为 0（含缺省值），无窗口读取、截图、手势、按键过滤等能力。验证该 XML 的所有资源配置变体，原样保留服务与资源。
- 连续的 `classes.dex` 至 `classes16.dex`；DEX 版本 035/037/038/039。
- 单个 DEX 至多 32 MiB，DEX 总量小于约 64 MiB；APK 大小上限 512 MiB。
- 资源、图片、网页资源及无关 META-INF 内容保持不变。

`browser` 配置明确排除：split APK/AAB、原生 SO/JNI、嵌套 APK/JAR、已有壳、未知自定义 AppComponentFactory、共享 UID、多进程、动态插件、instrumentation、额外权限、普通后台服务、Receiver 和 Provider。`embedded-native` 允许标准 `lib/<abi>/*.so` 与 Manifest 中的 Receiver/Provider/常规 Service，仍排除 split、共享 UID、嵌套 APK/JAR、未知 AppComponentFactory 与重复加壳。发现超出范围时停止，不伪造“加固成功”。即使通过静态预检，也仍需设备运行测试。

无障碍适配仅验证静态配置、保留类加载和系统绑定入口，**不代表已审核输入 APK 的全部运行行为**。服务在代码中动态改变事件配置也不属于此静态检查的保证。引擎不添加服务或权限、不自动开启无障碍，不增加节点、截图或输入采集功能。系统开关仍由用户手动控制。

## 工作流程

```text
原包只读检查 / 独立快照
    ↓
提取原始 DEX → 检查头、长度和校验值 → 生成有界 ZIP 载荷
    ↓
随机 AES-256 密钥 + 随机 96-bit nonce → AES-GCM 认证加密
    ↓
编译 ShieldFactory / PayloadCodec / 本包配置 → 启动 classes.dex
    ↓
仅修改 appComponentFactory 与明确允许的 minSdkVersion
    ↓
保留资源 → zipalign → 本地开发签名
    ↓
校验签名、对齐、Manifest 差异、未修改条目、解密往返
    ↓
output APK + JSON + log
```

启动时通过 `AppComponentFactory.instantiateClassLoader` 返回 `InMemoryDexClassLoader`，加载本 APK 内的认证加密 DEX；原组件通过默认或适配的 AndroidX 工厂创建。引擎没有网络取代码、隐藏 API 调用、新增后台服务或遥测。GCM 标签不匹配时启动报错，不退回加载未认证数据。

## 出错时如何定位

每次处理分配独立运行 ID。`output/` 内保留：

- **`.log`**：JSON Lines 格式，逐阶段的开始/结束时间、耗时、命令参数、退出码、分开的 stdout/stderr 和异常类型；命令输出省略/截断时明确标记。Manifest/资源表等可能带应用业务数据的 stdout 省略，只保留检查结论。日志不包含载荷密钥、密码值或 DEX 正文。
- **`.failure.json`**：失败阶段、输入文件与可取得的包信息、异常原因、已完成阶段、日志路径；不输出未通过验证的 APK。
- **`.private/logs/*.traceback.log`**：权限受限的构建端异常堆栈，失败报告中提供路径。
- **`.check.json`**：仅预检模式的结构与兼容性报告，不代表手机运行成功。
- **输出 APK 同名 `.json`**：输入/输出哈希、组件、签名、资源、Manifest 和解密往返结果，设备验证状态独立列出。

先看失败报告的阶段和原因，再定位同一运行 ID 日志中的失败命令。若是加载后闪退，打包日志本身不够，应结合设备日志：

```bash
# 从本目录运行；只读操作，不安装/卸载/启动应用，不更改系统设置、不清空日志
python3 collect_logs.py --package com.mtx.test
# 连接多个设备时
python3 collect_logs.py --package com.mtx.test --serial DEVICE_SERIAL
```

该脚本读取系统版本/机型/ABI 和 `APKShield` 标签的 Logcat。应用运行时按其 PID 限定；进程已退出时只保留标签过滤，报告会注明可能包含其他加壳应用，应核对包名和时间。只取有限近期日志，不读取完整设备日志。

运行时日志包括 `classloader`、`payload.read`、`payload.authenticate`、`payload.unpack`、`payload.dex.N`、`factory.create` 和 `component.create`，标注组件类型、类名、耗时与异常类型/栈位置。它不记录 Intent、网页内容、解密材料或任意异常消息正文。`component.create` 仅说明构造阶段；之后的生命周期崩溃可能需要另外查看相应应用的 Android 崩溃报告。

### 保护效果的实际边界

- 原始 DEX 不再直接作为根目录 `classes*.dex` 分发；根目录保留引擎加载代码。
- **解密密钥随加载器存放在 APK 内，可被提取；执行时原始代码也会出现于进程内存。** 此实现只增加直接静态查看成本，不承诺防脱壳、防修改或防破解。
- AES-GCM 用于检测此载荷的损坏/错误密钥。密钥可提取，因此它不是对攻击者重新打包的完整防护，也不是独立的应用签名校验机制。
- 资源、Manifest 和 HTML/JS 原样保留；不对这些内容进行加密。没有额外的反调试、反虚拟机或监控规避逻辑。
- 加载器会增加启动解密时间和内存开销，本版尚未测量机型性能。

## 本地依赖与迁移

复用同级 `android/apk-repack/repack.py` 的工具链定位、ZIP 检查、日志、签名和锁机制，不改其文件或配置。复制到另一台电脑时，请**同时保留 `android/apk-shield/` 与同级 `android/apk-repack/repack.py`**。

需要本机已有：

- Python 3.10+；仅标准库。
- JDK 17，SDK Platform 35，SDK Build Tools 35.0.0+。
- Android SDK command-line tools 的 `latest/bin/apkanalyzer`。
- ManifestEditor 2.0 JAR，放到本目录 `.tools/ManifestEditor-2.0.jar` 或同级 `android/apk-repack/.tools/`。

优先使用 `config.json` 指定的 `java_home`、`android_sdk`，其次环境变量及项目 `.local-tools`。**引擎处理过程不执行下载命令或网络请求。** 迁移前需自行准备以上依赖；整个工具链齐备后可断网运行。

ManifestEditor 来自 [官方项目发布页](https://github.com/WindySha/ManifestEditor/releases/tag/v2.0)，固定 SHA-256：

```text
70ccb3eabb12e0d743555f97722bfd62f563dbb6e8f1f3b3c7a645fe22cd685f
```

本机复用先前已下载的这份 JAR，没有重新下载。采用它仅处理 AXML，不调用其整包处理功能。

## 签名、隐私与回滚

- 首次运行在 `.private/development.p12` 创建独立自签名开发证书，不申请外部证书；后续复用。
- 本工具默认开发密钥口令为 `android`，alias 为 `apk-repack`，与复用的签名实现一致。该配置仅用于本地开发，正式发布需单独管理签名材料与口令。
- 与原 APK 的证书不同；若设备已安装相同包名的原版，直接覆盖通常会报签名不匹配。优先在独立测试设备安装；卸载会删除应用数据，应先备份。脚本不会自动卸载手机上的应用。
- 不上传 APK、密钥或日志；临时原包、解密材料位于权限受限的 `.private/.work-*`，正常结束/异常处理后清理。
- 强制终止进程或机器断电可能留下工作目录与 `run.lock`。确认进程已结束后再人工清理；不要删除 `development.p12`。
- 默认 JSON 报告始终写 `runtime_tested: false`；签名验证不冒充设备测试。
- 输入、输出、依赖、密钥和编译缓存均被 Git 忽略；日志包含本机文件路径和 Manifest 元数据，请按私有文件保管。
- 原包保留，回滚使用原 APK；引擎不会修改项目 Android 模板或已有 repack 配置。

## 测试

从仓库根目录运行：

```bash
python3 -m unittest discover -s android/apk-shield/tests -v
python3 -m unittest discover -s android/apk-repack/tests -v
```

覆盖范围：Manifest 支持边界、权限与组件检查、SDK 显式提升、DEX 校验、多 DEX 顺序、ZIP 保留、路径校验、输出防覆盖、真实 JDK AES-GCM 往返、错误密钥及密文篡改失败、共享 Android 解码逻辑的有界容器解析；另覆盖自定义 Application、AndroidX 工厂委托、状态服务 XML 配置和详细失败报告。结构测试中的最小 DEX 头和桌面 Android API stub 是合成数据，不代表 Android 设备执行；实际 APK 的构建另行记录。

设备验收清单：

1. Android 10+ 独立测试机安装，查看系统版本、型号与签名信息。
2. 冷启动/重启后启动，确认百度主页、返回键、链接跳转和 HTTPS 错误页面。
3. 切后台再返回、旋转、进程被系统终止后的重建。
4. 比较原版与输出包的启动耗时、内存和异常日志。
5. 在不同 Android 大版本与 WebView 版本上重复。
6. 状态服务样本：在系统设置手动开/关服务，返回应用确认状态；验证不读取窗口内容、事件正文或截图。

源码入口：`engine.py`（打包与校验）、`java/ShieldManifest.java`（AXML 两项变更）、`java/local/apkshield/runtime/ShieldFactory.java`（启动钩子）、`PayloadCodec.java`（共享解码）、`java/PayloadTool.java`（本地加密校验）。

参考：[Android 组件工厂](https://developer.android.com/reference/android/app/AppComponentFactory#instantiateClassLoader(java.lang.ClassLoader,%20android.content.pm.ApplicationInfo))、[内存 DEX 类加载器](https://developer.android.com/reference/dalvik/system/InMemoryDexClassLoader)、[动态代码加载注意事项](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading)。
