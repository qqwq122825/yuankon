# 快照协议 v1

完整示例：`backend/fixtures/example-snapshot.json`；作为协议与自动化测试夹具，当前无手动导入页面。

## 数据结构
- `schema_version`: 固定为 1。
- `captured_at`: 带时区的 ISO 8601 时间，表示原始采集时点，不是上传时间。
- `display`: `{width, height}`，正整数，最大各 10000。
- `windows`: 数组，最多 16 个窗口。每个窗口包含 `id`、`type`、`package`、`active`、`focused`、`root_status`、`nodes`。
- `type`: `application / system / input_method / accessibility_overlay / unknown`。
- `root_status`: `available / null_root / locked_skipped / filtered / error`。除 available 外节点列表应为空。
- `nodes`: 扁平数组；`id` 在窗口内唯一，`parent_id` 指向同一窗口，根节点使用 null。
- 节点属性：`class_name`、`view_id`、`bounds: [left,top,right,bottom]`、`text_present`、`flags`。
- `flags`: `visible / enabled / clickable / scrollable / editable / password / sensitive / focused`；未记录为 null，区别于 false。
- `diagnostics`: `elapsed_ms`（未知为 null）、`truncated`。这些值来自采集端，不是后台测量。

总节点上限 2000，树深度上限 32。拒绝重复 ID、悬空父节点、循环、反向矩形或超限输入。空窗口列表与空节点是合法研究结果，不自动推断原因。

## 密码与短信场景
可选 `observations` 数组，最多 100 条，记录合成测试数据的可见性：

```json
{
  "scenario": "password_field",
  "case_id": "PWD-001",
  "channel": "accessibility_event",
  "event_type": "TYPE_VIEW_TEXT_CHANGED",
  "fixture": "synthetic",
  "password_flag": true,
  "sensitive_flag": null,
  "text_returned": false,
  "synthetic_match": "not_tested"
}
```

- `scenario`: `password_field / sms_ui / sms_notification / sms_permission`。
- `channel`: `accessibility_node / accessibility_event / notification_listener / sms_permission`。
- `event_type`: `manual_probe / TYPE_VIEW_TEXT_CHANGED / TYPE_WINDOW_CONTENT_CHANGED / TYPE_NOTIFICATION_STATE_CHANGED`。
- `fixture`: 固定 `synthetic`，用例应来自预设虚构数据。
- `password_flag / sensitive_flag / text_returned`: true、false 或 null。
- `synthetic_match`: `match / mismatch / not_tested`。测试值在采集端比较，仅报告比较结果。
- 后台补充 `evidence: client_reported`。结果不是后台独立验证的事实。

缺少观察记录时省略或传空数组。正文、验证码、密码值、正文散列、未知附加字段均不会被序列化入库。测试机型与系统版本取关联设备记录；这些也是研究者填报信息。

## 截图
内部图片存储服务处理独立图片（网页上传入口已移除），最大 8 MB，总像素上限 1600 万、单边最大 8000。接受 PNG/JPEG/WebP，重新编码为 PNG 丢弃元数据与尾随内容。拒绝 SVG 上传。
截图不会自动进行 OCR 或内容遮蔽，导入者需要先检查图片。节点正文字段被剔除不代表截图中的文字同步被遮蔽。
截图保存在私有存储，以受项目检查的路由访问；禁止直接对外发布上传目录。

## 当前入口与导出
按用户要求，网页手动导入页面与 GET/POST /imports 路由已移除；这些地址返回 404。当前没有手机网络接入 API。既有数据继续保留。
内部样例测试工具保留 JSON、图片校验与事务逻辑，project_id 由服务端确定，不接受外部值作为归属。
导出的 JSON 为规范化数据，可用于离线复查；截图与关联设备信息不打包进 JSON。
