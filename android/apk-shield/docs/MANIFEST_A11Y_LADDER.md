# 91 ↔ 92 之间：建议与 101–110 基准

## 已确认

| # | Manifest 面 | 安装前扫描 |
|---|-------------|------------|
| **91** | 0 条 uses-permission，**无** `MyAccessibilityService` | 正常 |
| **92** | 0 条 uses-permission，**有** a11y Service + `BIND_ACCESSIBILITY`（在 Service 上） | 报毒 |

触发点更精确的说法：**无障碍 Service 组件声明**（不是多一条 uses-permission 列表里的「无障碍权限」）。

---

## 产品 / 交付建议（91 与 92 之间）

1. **默认交付（安装前要不报、功能仍可研究）**  
   - 继续用 **91 配方**：`remove_all` uses-permission + **`strip_accessibility` Service**。  
   - 无障碍能力：**用户在系统设置里手动开启**；运行时仍可通过代码引导，但 **Manifest 不暴露** 完整 `AccessibilityService` 绑定声明（与 AGENTS 边界一致）。

2. **扫描引擎（自研安全中心）**  
   - 单独规则：**`<service>` + `BIND_ACCESSIBILITY_SERVICE` / `AccessibilityService` action**。  
   - 可选次级：**仅 `uses-permission` 含 `BIND_ACCESSIBILITY_SERVICE`**（用 **101** 验证是否也报）。  
   - 避免：只有 91 形态才不报 → 92 一声明就报，但 **原包重签 2** 仍报（DEX/多特征线）。

3. **若将来必须 Manifest 留 Service（102/103）**  
   - 接受安装前可能报毒，或走 **研究白名单 / 分级提示**（非「静默放行」）。  
   - **103**（BIND uses-permission + Service）比 **92** 更接近原包，用于测最坏情况。

4. **不建议的「中间糊弄」**（未做进探针、易误导读条）  
   - 只改 Service `android:label`、只关 `exported` 但保留 `AccessibilityService` filter —— 扫描若做结构化解析仍可能报。  
   - 需要时可再加 **111+** 做属性级消融。

---

## 101–110 矩阵（加壳同 91，只变 Manifest）

| # | 构造 | 要回答 |
|---|------|--------|
| **101** | engine `keep_only BIND` + 剥 Service | **本样本原 Manifest 无 BIND uses-permission**（BIND 只在 Service 上），故 **101≈91**；若仍报/不报与 91 一致 |
| **102** | 同 **92**（无 uses-permission，有 Service） | 对照 |
| **103** | `keep_only BIND`、不剥 Service | 对本样本 **103≈102**（无 BIND uses-permission 可保留）；对照用 **102** 即可 |
| **104** | 仅 **网络** uses-permission，无 Service | 无害权限对照 |
| **105** | **网络 + Service**（同 93） | 常见组合 |
| **106** | 102 + **去 queries** | queries 是否加重 |
| **107** | 去高危权限 + **无 Service**（同 94 剥 a11y） | 多权限无 Service |
| **108** | 仅 **READ_SMS** uses-permission，无 Service | 敏感单权限是否报 |
| **109** | **101** + 中性包名 | 包名是否叠加 |
| **110** | **103** + 中性包名 | 包名 + 完整 a11y 面 |

生成：

```bash
cd apk-shield
python3 build_install_matrix.py 101 102 103 104 108 109
```

### 建议阅读顺序

1. **101 vs 91 vs 102** → 报毒来自 **Service** 还是 **BIND uses-permission** 或两者  
2. **103 vs 102** → 多一条 BIND permission 是否更严  
3. **108 vs 101** → 是否 **仅 a11y 相关** 才触发  
4. **109/110** → 包名是否独立  

---

## 实测记录

完整表见 **[INSTALL_TEST_LOG.md](./INSTALL_TEST_LOG.md)**（每轮测试后追加）。  
2026-09-24：**101–108 均报毒**；**91 仍为目标基线**。

---

## 与旧矩阵的关系

- **91** = **7**；**102** = **92** = **4**（加壳路径）。  
- **105** ≈ **93**；**107** ≈ **94** + 剥 a11y。  
- 原包重签 **82/83** 线与加壳 **91+** 线仍是 **两套模型**，勿混评。
