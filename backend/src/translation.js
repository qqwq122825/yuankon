import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { z } from 'zod';
import he from 'he';
import { fail } from './protocol.js';
export const translationSchema = z
    .object({
        enabled: z.boolean(),
        language: z.enum(['zh-CN', 'zh-TW', 'en', 'ja', 'es']),
        apiKey: z.string().max(300).optional(),
    })
    .strict();
export class Translation {
    constructor(db, config, key, fetcher = fetch) {
        this.db = db;
        this.projectId = config.projectId;
        this.fetcher = fetcher;
        this.cache = new Map();
        this.key = Buffer.from(hkdfSync('sha256', key, 'boundary', 'translation-v1', 32));
    }
    encrypt(value) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
    }
    decrypt(value) {
        const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
        const cipher = createDecipheriv('aes-256-gcm', this.key, iv);
        cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    }
    async get() {
        const row = await this.db('node_settings').where('project_id', this.projectId).first();
        return row?.translation
            ? JSON.parse(row.translation)
            : { enabled: false, language: 'zh-CN', encryptedKey: null, verifiedAt: null };
    }
    async publicState() {
        const s = await this.get();
        return {
            enabled: s.enabled,
            language: s.language,
            hasKey: !!s.encryptedKey,
            verifiedAt: s.verifiedAt,
        };
    }
    async save(input) {
        const data = translationSchema.parse(input),
            previous = await this.get();
        const value = {
            enabled: data.enabled,
            language: data.language,
            encryptedKey: data.apiKey?.trim()
                ? this.encrypt(data.apiKey.trim())
                : previous.encryptedKey,
            verifiedAt: null,
        };
        if (value.enabled && !value.encryptedKey) throw fail(422, '请填写翻译 API Key');
        await this.db('node_settings')
            .insert({ project_id: this.projectId, translation: JSON.stringify(value) })
            .onConflict('project_id')
            .merge();
        this.cache.clear();
        return this.publicState();
    }
    async clear() {
        await this.db('node_settings').where('project_id', this.projectId).delete();
        this.cache.clear();
        return this.publicState();
    }
    async translate(labels, verify = false, source = 'en') {
        const s = await this.get();
        if (!s.encryptedKey || (!verify && !s.enabled)) throw fail(422, '请先保存并启用翻译设置');
        if (!Object.keys(labels).length) return {};
        const key = JSON.stringify([s.language, source || 'auto', labels]);
        const cached = this.cache.get(key);
        if (!verify && cached && cached.expires > Date.now()) return cached.value;
        let items;
        try {
            const response = await this.fetcher(
                'https://translation.googleapis.com/language/translate/v2',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': this.decrypt(s.encryptedKey),
                    },
                    redirect: 'error',
                    signal: AbortSignal.timeout(12000),
                    body: JSON.stringify({
                        q: Object.values(labels),
                        ...(source ? { source } : {}),
                        target: s.language,
                        format: 'text',
                        model: 'nmt',
                    }),
                },
            );
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error();
            }
            let size = 0;
            const chunks = [];
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > 65536) throw new Error();
                chunks.push(chunk);
            }
            items = JSON.parse(Buffer.concat(chunks).toString()).data?.translations;
            if (
                !Array.isArray(items) ||
                items.length !== Object.keys(labels).length ||
                items.some(
                    (i) =>
                        typeof i.translatedText !== 'string' ||
                        i.translatedText.length > 1000 ||
                        !i.translatedText.trim(),
                )
            )
                throw new Error();
        } catch {
            throw fail(502, '翻译请求失败，请检查密钥、额度与网络');
        }
        const value = Object.fromEntries(
            Object.keys(labels).map((k, i) => [k, he.decode(items[i].translatedText)]),
        );
        if (this.cache.size > 100) this.cache.clear();
        this.cache.set(key, { value, expires: Date.now() + 600000 });
        if (verify) {
            s.verifiedAt = new Date().toISOString();
            await this.db('node_settings')
                .where('project_id', this.projectId)
                .update({ translation: JSON.stringify(s) });
        }
        return value;
    }
}
