# Vue 前端

- `src/`：页面、共享组件、样式。
- `public/`：Tabler 预编译资源、许可证与图标；由 Node 静态路由提供。
- `test/`、`playwright.config.js`：浏览器测试，使用临时后端数据库。
- `dist/`、`node_modules/`、`test-results/`：生成目录，Git 忽略。

本目录 `npm ci && npm run build` 编译前端。通常直接从项目根执行统一 npm 命令；开发时使用根目录 `npm run dev` 启动同域 Express + Vite，不单独运行裸 Vite 服务器。

本目录 `npm run test:e2e` 自动编译并启动临时后端测试服务，不改变真实工作区账号/数据。
