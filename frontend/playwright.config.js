import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    testDir: './test',
    outputDir: './test-results',
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:8081',
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'node ../backend/test/browser-server.js',
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        url: 'http://127.0.0.1:8081/api/health',
        reuseExistingServer: false,
        timeout: 20000,
    },
});
