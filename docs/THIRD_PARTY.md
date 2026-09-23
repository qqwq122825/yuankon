# 第三方组件

- Laravel Framework 13：Composer 管理，具体版本与许可证见 composer.lock 和 vendor 内分发内容。
- Laravel Sanctum 4.3.3：设备 API Bearer 令牌、能力范围与有效期；MIT，版本锁定于 composer.lock。
- Tabler Core 1.5.1：来自 npm 官方包 `@tabler/core`，仅使用预编译 CSS/JS，MIT。
  - 上游：https://github.com/tabler/tabler
  - 本地许可证：public/vendor/tabler/LICENSE
  - 为离线使用移除了 CSS 的 Google Fonts 导入和 sourceMappingURL 引用，其他组件规则保持上游实现。
- Tabler Icons 3.35.0：来自官方 GitHub 对应版本，只保留本项目使用的 SVG，MIT。
  - 上游：https://github.com/tabler/tabler-icons
  - 本地许可证：public/vendor/icons/LICENSE

界面表格、表单、按钮、徽章、卡片基于 Tabler。应用只补充布局、品牌样式和研究专用的节点查看器，不重新实现通用组件库。
示例界面 SVG 为项目自行绘制的功能性测试图，并非用户设备截图。
