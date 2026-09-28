# Android 模板与本地工具

- [apk-templates/](apk-templates/README.md)：版本清单与实际源码，screenagent-1.7 / browser-1.0。
- `scripts/`：CLI 构建与既有辅助脚本。
- `installer/`：既有离线安装器源码。
- `apk-repack/`、`apk-shield/`：既有独立工具，彼此仍同级；本轮原样移动，不加入网页构建队列。
- `.local-tools/`：JDK、SDK、Gradle、开发签名、缓存，仅本机保留。
- `inputs/`：原有 APK 输入，仅本机保留。
- `dist/`：独立 CLI 构建产物，仅本机保留。
- `legacy-scaffold/`：原空 Android 目录内容，不作为模板使用。

在项目根执行 `npm run build:apk` 或 `npm run build:screenagent`；后台网页产物另存于 backend/.node-private，不是此处 dist。

路径调整不会提升工具的适用范围，编译/签名校验与真机验证仍分别报告。新增模板参阅 [根目录 APK 指南](../README_APK.md)。
