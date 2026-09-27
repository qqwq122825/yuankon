import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [vue({ template: { transformAssetUrls: false } })],
    publicDir: false,
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
        host: '127.0.0.1',
        fs: {
            allow: [
                fileURLToPath(new URL('.', import.meta.url)),
                fileURLToPath(new URL('./node_modules', import.meta.url)),
            ],
            deny: [
                '**/.env',
                '**/.env.*',
                '**/*.{crt,pem,key}',
                '**/.git/**',
                '**/.node-private/**',
                '**/database/**',
                '**/storage/**',
            ],
        },
    },
});
