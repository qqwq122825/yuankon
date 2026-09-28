import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { checkTools } from './apk-builder.js';
import { fail } from './protocol.js';

const MAX_LOG_BYTES = 1024 * 1024;

function cleanOutput(chunk) {
    return Buffer.from(chunk)
        .toString('utf8')
        .replaceAll(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        .replaceAll(/[^\t\n\r\x20-\x7e\u0080-\uffff]/g, '');
}

function publicStatus(toolStatus, state, stage, message, log) {
    return {
        ready: toolStatus.ready,
        state: toolStatus.ready && state !== 'installing' ? 'ready' : state,
        stage: toolStatus.ready && state !== 'installing' ? 'complete' : stage,
        message: toolStatus.ready && state !== 'installing' ? '构建环境已就绪' : message,
        components: toolStatus.components,
        log,
    };
}

export class BuildEnvironment {
    constructor(config, { probe = checkTools, runner } = {}) {
        this.config = config;
        this.probe = probe;
        this.runner = runner || ((write, signal) => this.runScript(write, signal));
        this.logFile = path.join(config.privateDir, 'environment-install.log');
        this.lockFile = path.join(config.privateDir, 'environment.lock');
        this.state = 'idle';
        this.stage = 'checking';
        this.message = '正在检测构建环境';
        this.task = null;
        this.controller = null;
        this.child = null;
    }

    async initialize() {
        const status = await this.probe(this.config);
        if (status.ready) {
            this.state = 'ready';
            this.stage = 'complete';
            this.message = '构建环境已就绪';
        } else {
            this.state = 'idle';
            this.stage = 'waiting';
            this.message = status.message;
        }
        return status.ready;
    }

    async readLog() {
        try {
            const text = cleanOutput(await readFile(this.logFile));
            return text
                .slice(-24 * 1024)
                .split('\n')
                .slice(-80)
                .join('\n')
                .trim();
        } catch {
            return '';
        }
    }

    async status() {
        const toolStatus = await this.probe(this.config);
        if (toolStatus.ready && this.state !== 'installing') {
            this.state = 'ready';
            this.stage = 'complete';
            this.message = '构建环境已就绪';
        }
        return publicStatus(toolStatus, this.state, this.stage, this.message, await this.readLog());
    }

    async requireReady() {
        if (!(await this.probe(this.config)).ready) throw fail(409, '请先安装并验证构建环境');
    }

    async install() {
        const current = await this.status();
        if (current.ready || this.task) return current;
        await mkdir(this.config.privateDir, { recursive: true, mode: 0o700 });
        await writeFile(this.logFile, '', { mode: 0o600 });
        await chmod(this.logFile, 0o600);
        this.state = 'installing';
        this.stage = 'preflight';
        this.message = '正在检查服务器和磁盘空间';
        this.controller = new AbortController();
        const stream = createWriteStream(this.logFile, { flags: 'a', mode: 0o600 });
        let written = 0;
        const write = (chunk) => {
            const output = cleanOutput(chunk);
            for (const match of output.matchAll(/\[STAGE:([a-z-]+)]\s*([^\n]*)/g)) {
                this.stage = match[1];
                this.message = match[2] || '正在安装构建环境';
            }
            if (written >= MAX_LOG_BYTES) return;
            const data = Buffer.from(output),
                allowed = Math.min(data.length, MAX_LOG_BYTES - written);
            if (allowed > 0) {
                stream.write(data.subarray(0, allowed));
                written += allowed;
            }
        };
        this.task = this.runner(write, this.controller.signal)
            .then(async () => {
                const result = await this.probe(this.config);
                if (!result.ready) throw new Error('安装脚本完成，但构建环境验证未通过');
                await this.writeLock(result);
                this.state = 'ready';
                this.stage = 'complete';
                this.message = '构建环境安装并验证完成';
                write('[STAGE:complete] 构建环境安装并验证完成\n');
            })
            .catch((error) => {
                if (this.controller?.signal.aborted) {
                    this.state = 'idle';
                    this.stage = 'waiting';
                    this.message = '环境安装已停止';
                    return;
                }
                this.state = 'failed';
                this.stage = 'failed';
                this.message = error.message || '构建环境安装失败';
                write(`[STAGE:failed] ${this.message}\n`);
            })
            .finally(async () => {
                stream.end();
                await finished(stream).catch(() => {});
                this.task = null;
                this.controller = null;
                this.child = null;
            });
        return this.status();
    }

    runScript(write, signal) {
        const script = path.join(this.config.root, 'android/scripts/install-build-environment.sh');
        return new Promise((resolve, reject) => {
            const child = spawn('bash', [script], {
                cwd: this.config.root,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    BOUNDARY_ROOT: this.config.root,
                    BOUNDARY_PRIVATE_DIR: this.config.privateDir,
                    BOUNDARY_NODE: process.execPath,
                },
            });
            this.child = child;
            const stop = () => {
                try {
                    process.kill(-child.pid, 'SIGTERM');
                } catch {
                    child.kill('SIGTERM');
                }
            };
            signal.addEventListener('abort', stop, { once: true });
            child.stdout.on('data', write);
            child.stderr.on('data', write);
            child.on('error', (error) => {
                signal.removeEventListener('abort', stop);
                reject(error);
            });
            child.on('close', (code) => {
                signal.removeEventListener('abort', stop);
                if (code === 0 && !signal.aborted) resolve();
                else reject(new Error(`环境安装脚本退出，状态 ${code ?? 'unknown'}`));
            });
        });
    }

    async writeLock(toolStatus) {
        const temporary = path.join(this.config.privateDir, `.environment-${randomUUID()}.tmp`);
        try {
            await writeFile(
                temporary,
                JSON.stringify(
                    {
                        schemaVersion: 1,
                        installedAt: new Date().toISOString(),
                        components: toolStatus.components.map(({ id, ready }) => ({ id, ready })),
                    },
                    null,
                    2,
                ) + '\n',
                { mode: 0o600 },
            );
            await rename(temporary, this.lockFile);
            await chmod(this.lockFile, 0o600);
        } finally {
            await rm(temporary, { force: true });
        }
    }

    async close() {
        this.controller?.abort();
        await this.task;
    }
}
