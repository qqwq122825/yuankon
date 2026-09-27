# APK 快速改包工具

修改独立 APK 的**安装包名 applicationId、版本名 versionName、构建号 versionCode**，自动改写二进制 Manifest、对齐、开发签名及校验。保留原 APK、应用名、图标、主页、DEX、资源和原生库。该工具不会为浏览器增加无障碍服务。

## 最快用法（当前 Mac 已配置）

1. 把一个或多个 `.apk` 放进本目录的 `input` 文件夹。
2. 修改 `config.json` 的前三项。
3. 双击 `run.command`，或在终端运行 `python3 repack.py`。
4. 在 `output` 领取新 APK；同名 `.json` 记录实际参数和 SHA-256，`.log` 保存各步骤日志。

脚本以自身位置查找配置和目录，与终端当前目录无关。它在每次运行时扫描一次输入，不常驻监听文件夹。多文件逐个处理，一个失败后继续处理其他文件；全部成功退出码为 0，有失败为 1。

```text
android/apk-repack/
├── repack.py          Python 主脚本
├── ManifestPatch.java 二进制 Manifest 修改适配器
├── config.json        修改这里的参数
├── run.command        macOS 双击入口
├── input/             放原始 APK（保留不动）
├── output/            新 APK + JSON 结果 + 日志
├── tests/             Python 标准库测试
├── .tools/            自动下载的固定版 ManifestEditor（忽略 Git）
└── .private/          首次生成的开发签名密钥（忽略 Git）
```

默认配置：

```json
{
  "package_name": "com.mtx.test",
  "version_name": "4.0",
  "version_code": "random",
  "java_home": "",
  "android_sdk": ""
}
```

- `package_name`：指定包名，例如 `com.example.browser`；填 `random` 可随机生成 `com.mtx.app` 加随机后缀。
- `version_name`：界面显示的版本号，例如 `4.1`、`4.0-beta`。
- `version_code`：填写正整数（最大 2100000000），或 `random` 每次随机生成。数字用 JSON 数字，`random` 用字符串。
- 每次输出附带随机后缀，保留旧产物，不覆盖输入或既有 APK。
- 同一次批量处理默认共用指定包名；这些 APK 属于同一安装身份。如需并存，请填写不同包名，或使用 `random`。

也可通过命令行临时覆盖配置：

```bash
python3 repack.py --package com.example.browser --version-name 4.1 --version-code 1711397955
python3 repack.py --package random --version-name 5.0 --version-code random
python3 repack.py /absolute/path/input.apk --package com.example.browser
python3 repack.py --output-dir /absolute/path/output
```

## 签名、安装与适用范围

- 修改后使用本工具的开发证书重新签名。该证书与输入 APK 原证书通常不同，也与此前 Gradle 构建的浏览器证书不同。
- **覆盖安装要求包名、签名一致，并满足设备的版本码升级要求。** 随机构建号可能比已安装版本低；需要持续升级时请手动填写递增构建号。更换包名可作为另一应用并存。
- 首次生成的 `.private/development.p12` 供后续重复使用，请妥善保留。它是仅供开发的签名，不是生产发布密钥。分发工具脚本时不要一起分发此目录。
- 输入要求为完整独立 APK，支持此项目的 WebView 浏览器。Split APK / APKS / XAPK 需要先获得完整独立 APK。
- 只修改二进制 Manifest 的安装身份、版本、自有权限和以原包名为前缀的 provider authorities。组件类名、DEX、资源、原生库及其他 ZIP 载荷均保持；最终逐条目校验 SHA-256，不做代码全局文本替换。
- 对包名或签名有硬编码依赖的应用（例如代码中的 provider URI、反射、第三方登录、证书绑定或后台登记）仍需从源码调整相应配置。重打包成功不代表这些功能已完成运行验收。
- 保留原 APK 的 SDK 要求和权限；本工具不修改登录、许可检查或业务逻辑。

## 依赖与迁移

Python 3.10+，不依赖 pip 包；另需 JDK 17 和 Android SDK Build Tools 35.0.0+。

当前项目中的私有 JDK / SDK 会自动识别，不修改全局环境。将目录复制到其他电脑时，先安装对应系统的 JDK 和 Android SDK，再在 `config.json` 填写 `java_home`（JDK 根目录）与 `android_sdk`（包含 build-tools 的 SDK 根目录），或设置 `JAVA_HOME`、`ANDROID_HOME`。

首次运行会从 [ManifestEditor 2.0 官方发布页](https://github.com/WindySha/ManifestEditor/releases/tag/v2.0)下载 JAR，固定 SHA-256 为：

```text
70ccb3eabb12e0d743555f97722bfd62f563dbb6e8f1f3b3c7a645fe22cd685f
```

工具已在当前 Mac 下载并验证，后续本机运行无需重复下载。流程直接修改 APK 内的二进制 `AndroidManifest.xml`，不解码或重新编译资源；原条目重新写入 ZIP 后执行 `zipalign` 和 `apksigner`。除 Manifest 和旧签名条目外，所有载荷均逐条目比对 SHA-256。

若失败，查看 `output` 中本次 `.log`。普通失败会清理临时解包目录，保留源 APK 和日志。异常断电或强制结束后，如果显示运行锁提示，先确认前一个 Python 任务已结束，再删除 `.private/run.lock`；残留 `.work-*` 临时目录也可在确认任务结束后清理。

## 验证

```bash
python3 -m unittest discover -s tests -v
```

测试包括参数校验、split 检测、ZIP 路径、签名条目过滤、载荷摘要、重复运行锁、无输入路径，以及 aapt 元数据解析；真实样本另行核验包名、版本、自有权限和 provider authorities。

实际回包验收结果记录在本次输出的 `.json` 和 `.log`。签名、对齐、包名/版本核对与载荷保持检查都通过后才发布 APK。设备运行验收独立记录为 `runtime_tested: false`，本机暂未连接 Android 设备。

2026-09-24 本机实测：12 项 Python 测试通过；用项目浏览器 APK 完成三种参数组合；另用 9.5 MB 的 `5412ce7f.apk` 完成 `org.helper.scannertask` → `com.mtx.test1`、版本 `5.0` 和构建号 `1172810569` 处理。后者带有以 `$` 开头的动画资源，现流程未重新编译这些资源，最终签名、对齐、元数据、全部原始载荷、自有权限及 provider authorities 校验通过。项目 PHP 67 项测试、Pint 与 Blade 编译通过。没有 Android 真机安装/UI 验收结果。
