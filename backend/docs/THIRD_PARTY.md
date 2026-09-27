# 第三方组件

当前 npm 依赖及版本固定于 `package-lock.json`；具体许可证以依赖包随附文件为准。

- Vue 3、Vue Router、Vite：前端页面、路由和构建。
- Express 5、ws、Knex、better-sqlite3：HTTP、WS、数据库访问与 SQLite。
- Passport Local / JWT、jose、argon2：身份策略、Token 与密码散列。
- Zod、Helmet、express-rate-limit、cookie、Sharp、he：校验、响应头、限流、Cookie、图片处理与实体解码。
- Prettier、Playwright：格式与浏览器测试。
- Tabler Core 1.5.1：复用本地预编译 CSS；MIT，许可证 `frontend/public/vendor/tabler/LICENSE`。离线版移除了 Google Fonts 导入与 sourceMappingURL。
- Tabler Icons 3.35.0：本地 SVG 图标；MIT，许可证 `frontend/public/vendor/icons/LICENSE`。

界面基于既有 Tabler，不另建通用组件库。`backend/fixtures/settings.svg` 是合成测试图，不是真机截图。Android 固定模板使用 Gradle / Android Gradle Plugin / Android SDK，工具链和签名保持私有。旧 PHP 依赖已移除。
