import { config } from './config.js';
import { createApplication } from './app.js';
const settings = config();
if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535)
    throw new Error('NODE_PORT should be between 1024 and 65535');
const instance = await createApplication(settings, { dev: process.argv.includes('--dev') });
instance.server.on('error', async (error) => {
    console.error(`启动失败：${error.code}`);
    await instance.close();
    process.exitCode = 1;
});
instance.server.listen(settings.port, '127.0.0.1', () =>
    console.log(`Boundary Lab Vue + Node: ${settings.origin}`),
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
        if (stopping) return;
        stopping = true;
        await instance.close();
        process.exit(0);
    });
