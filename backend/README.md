# Node 后端

- `src/`：Express API、认证、SQLite、WS、APK 队列。
- `test/`、`fixtures/`：后端测试、合成数据。
- `docs/`：协议与部署说明。
- `.node-private/`：SQLite、密钥、上传文件、网页 APK、构建日志与备份（Git 忽略）。

优先在项目根运行 `npm ci && npm run build && npm start`。也可在本目录执行 `npm ci`、`npm start`、`npm test`；生产页面需已构建至 ../frontend/dist。`npm run dev` 使用前端目录中的 Vite 配置，仍由同一个服务提供网页/API/WS。

数据库位置不随启动目录改变。Android 模板在 [统一模板目录](../android/apk-templates/README.md)，与 Node 服务源码分开管理。
