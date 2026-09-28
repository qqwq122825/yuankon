import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fail } from './protocol.js';

export class Installation {
    constructor(db, config, accounts) {
        this.db = db;
        this.config = config;
        this.accounts = accounts;
        this.installed = false;
        this.lockFile = path.join(config.privateDir, 'install.lock');
    }
    async initialize() {
        const root = await this.db('accounts').where({ role: 'superadmin' }).orderBy('id').first();
        this.installed = Boolean(root);
        if (root) await this.writeLock(root, false, 'existing-account');
        return this.installed;
    }
    status() {
        return { installed: this.installed };
    }
    async install(input, ip) {
        if (this.installed) throw fail(409, '系统已完成初始化安装');
        const user = await this.accounts.install(input, ip);
        this.installed = true;
        await this.writeLock(user, true, 'web-installer');
        return { installed: true, user: await this.accounts.publicUser(user) };
    }
    async writeLock(user, replace, source) {
        await mkdir(this.config.privateDir, { recursive: true, mode: 0o700 });
        if (!replace) {
            try {
                const current = JSON.parse(await readFile(this.lockFile, 'utf8'));
                if (current.accountId === user.id && current.username === user.username) return;
            } catch {}
        }
        const temporary = path.join(this.config.privateDir, `.install-${randomUUID()}.tmp`);
        try {
            await writeFile(
                temporary,
                JSON.stringify(
                    {
                        schemaVersion: 1,
                        installedAt: new Date().toISOString(),
                        source,
                        accountId: user.id,
                        username: user.username,
                        apkId: user.apk_id,
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
}
