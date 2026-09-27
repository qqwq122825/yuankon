# 浏览器构建验收 · 2026-09-28

## 实际操作

在本机 `http://127.0.0.1:8080` 的浏览器中，以已有超管登录，通过构建页面填写参数、生成随机包名并提交一次真实任务。未使用 API 脚本代替此次页面提交，也未使用测试队列模拟 APK。

| 参数 | 本次值 |
|---|---|
| 模板 | `screenagent-1.0` / v1.0 · ScreenAgent 单张截图 |
| 后台域名 | `local`（本机 USB 联调配置） |
| APP 名称 | Rivo TV |
| 首页 | `https://www.reelshort.com` |
| APK ID | `10074`（沿用既有超管归属） |
| 批次 | `browser-acceptance-20260928` |
| 随机包名 | `org.boundary.app.pfc420b44c0514678` |
| 构建 ID | `129af5ab-3150-4e3d-b79f-eb3d7533bf9b` |

## 已验证

- 页面展示编译 / Lint 进度，自动刷新至「已完成」；Gradle 日志显示 `assembleDebug`、`lintDebug` 成功，耗时 36 秒。
- 「复制链接」后页面提示成功，浏览器剪贴板内容与该任务下载地址一致；链接仍要求后台登录。
- 「下载 APK」触发浏览器下载，文件为本机 Downloads 目录中的 `application-129af5ab.apk`，大小 **3,729,516 字节**。
- 下载文件和服务端私有产物的 SHA-256 均为 `83ef01cbe391faddb89d8f0954478357ca1b9bcbfb827f2b86d53a3641d1de89`，与页面展开的校验值一致。
- `apksigner verify --verbose` 通过（v2 开发签名），`zipalign -c -p 4` 通过。
- `aapt dump badging` 核对应用名称、包名与版本 `1.0.0`（versionCode 1）；APK 的 `assets/agent_config.json` 核对后台地址、首页、APK ID、批次和构建 ID，均与表单一致。
- 本次浏览器控制台未发现错误；刷新页面后任务及产物仍可访问。
- `npm run check`：格式检查、Vue 生产构建及 **58 项 Node 测试**通过。
- `npm run test:e2e`：**11 项 Chromium 测试**通过，其中构建页自动化采用明确标注的模拟队列，与本次真实 APK 验收分开记录。
- 保留的独立 Android 工具源码运行既有单元测试：repack **12 项**、shield **64 项**通过；未新增这些工具的功能或生成其交付包。

## 产物与边界

服务端 APK、构建日志与截图分别保存在 `backend/.node-private/files/apk-builds/`、`backend/.node-private/build-work/`、`backend/.node-private/verification/`，不进入 Git。下载到本地的 APK 同样不提交。源码仓库包括模板、清单、锁文件和说明，不包括数据库、密钥、工具链和依赖。

此次验证的是网页构建与下载链路，没有安装或运行手机应用，也没有把合成图片测试视为真机截图上报。`local` 指向本机联调地址；远程设备部署、正式签名、总台机器人及连续截图另行实施。
