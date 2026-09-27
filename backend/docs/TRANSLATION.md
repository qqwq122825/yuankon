# 阅读器翻译

## 使用
1. 打开 `/settings/translation`（主导航「翻译」）。
2. 保存自己的 Google API Key，选择目标语言，勾选启用。
3. 「保存设置」仅写入本地配置；「验证已保存密钥」会发送固定英文 `Synthetic fixture`，可能产生翻译费用。界面只在请求实际成功后显示验证时间。
4. 设备页打开阅读器，点击「翻译」；点击「原文」恢复原始样例标签。打开阅读器、调宽度、调字号都不会自动发送翻译请求。

## 已实现的接入
- 提供商：Google Cloud Translation Basic v2，固定 HTTPS endpoint；模型参数 `nmt`。不将参考截图中的 `general/nmt` 直接作为 v2 参数。
- REST 参数和响应遵循 [Google translate 文档](https://cloud.google.com/translate/docs/reference/rest/v2/translate)。API Key 用 `X-Goog-Api-Key` 头发送，依据 [Google 系统参数](https://cloud.google.com/apis/docs/system-parameters)。
- API Key 认证适用于 Basic v2；参见 [认证说明](https://cloud.google.com/translate/docs/authentication)。在提供商侧配置 API 限制、额度以及适合部署环境的调用方限制。
- API Key 使用 AES-256-GCM 保存，独立密钥由 `backend/.node-private/master.key` 派生；页面与模型 JSON 不回显，表单验证失败不闪存密钥。留空保留已有 Key。
- 当前配置以 project_id 隔离；子账号继承尚未实现。端点固定，不接受浏览器传入任意代理地址。
- 请求限制每分钟 20 次；总超时 12 秒，不自动重试、不跟随重定向。错误只显示净化后的分类提示。
- 同一翻译实例内按语言和固定标签集缓存 10 分钟；保存或删除配置清空缓存。

## 数据范围
`backend/src/protocol.js` 的 `labelsFor` 根据样例节点资源 ID 选取代码中固定的英文标签。只有 sample 来源参与，密码/敏感/可编辑节点排除。原始节点 payload 不因翻译增加正文；JSON 导出保持原格式。

接口只接收快照 ID，拒绝客户端传入待译字符串；不将截图、任意节点文本、密码、短信、设备标识或资源 ID 发给提供商。请求体只有固定标签数组、语言和模型参数。

Myranslate 及通用自定义服务尚未接入；需要明确接口文档后再增加独立适配器，不凭界面截图猜测协议。

## 验证状态
Node 自动化测试使用可注入的 fetch 响应 覆盖加密、留空保留、校验、验证成败、超时、响应格式、缓存失效、禁用、敏感标签过滤和项目隔离，并阻止测试触发外部请求。浏览器检查了 300px/220px/500px 尺寸、字号、搜索、键盘页签、关闭与缺少配置的提示。

开发阶段没有填写真实提供商密钥，真实账号配额与联网翻译需使用者在设置页手动验证。
