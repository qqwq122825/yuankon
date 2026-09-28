import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fail } from './protocol.js';

const text = (max) =>
    z
        .string()
        .trim()
        .min(1)
        .max(max)
        .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const templateSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/),
        name: text(100),
        versionName: z.string().regex(/^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-zA-Z0-9]+)?$/),
        versionCode: z.number().int().min(1).max(2100000000),
        sourceDir: z
            .string()
            .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$/),
        kind: z.enum(['browser', 'screenagent', 'installer']),
        description: text(300),
    })
    .strict();
export const buildInput = z
    .object({
        templateId: text(64),
        domain: z.string().trim().max(255).default(''),
        appName: text(80),
        homeUrl: z.string().trim().max(2048).default(''),
        apkId: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]{0,64}$/)
            .default(''),
        batch: z
            .string()
            .trim()
            .max(80)
            .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
            .default(''),
        packageName: z.string().trim().max(180).default(''),
        requestId: z.string().uuid(),
    })
    .strict()
    .superRefine((value, context) => {
        if (!value.homeUrl) return;
        try {
            const url = new URL(value.homeUrl);
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        } catch {
            context.addIssue({
                code: 'custom',
                path: ['homeUrl'],
                message: '首页网址必须是 HTTPS 地址',
            });
        }
    });
export function packageName(value) {
    if (!value) return `org.boundary.app.p${randomBytes(8).toString('hex')}`;
    const reserved = new Set([
        'class',
        'package',
        'public',
        'private',
        'int',
        'null',
        'true',
        'false',
        'new',
        'if',
        'else',
        'return',
        'void',
        'for',
        'while',
        'switch',
        'case',
        'default',
        'import',
        'static',
        'final',
        'this',
        'super',
        'do',
        'try',
        'catch',
        'throw',
        'throws',
        'interface',
        'enum',
        'extends',
        'implements',
        'abstract',
        'assert',
        'boolean',
        'break',
        'byte',
        'char',
        'const',
        'continue',
        'double',
        'finally',
        'float',
        'goto',
        'instanceof',
        'long',
        'native',
        'protected',
        'short',
        'strictfp',
        'synchronized',
        'transient',
        'volatile',
    ]);
    if (
        !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value) ||
        value.split('.').some((p) => reserved.has(p))
    )
        throw fail(422, '包名请使用小写字母开头的多段标识，或留空自动生成');
    return value;
}
export async function loadTemplates(root) {
    const rows = z
        .array(templateSchema)
        .min(1)
        .max(40)
        .parse(
            JSON.parse(
                await readFile(path.join(root, 'android/apk-templates/templates.json'), 'utf8'),
            ),
        );
    if (new Set(rows.map((t) => t.id)).size !== rows.length)
        throw new Error('Duplicate template ID');
    return rows;
}
export async function templateSource(root, template) {
    const base = await realpath(path.join(root, 'android/apk-templates')),
        source = await realpath(path.join(base, template.sourceDir));
    if (!source.startsWith(base + path.sep) || !(await stat(source)).isDirectory())
        throw fail(422, '模板路径校验失败');
    return source;
}
export async function backendOrigin(config, input) {
    if (input === 'local') return config.origin;
    const aliases = JSON.parse(
        await readFile(path.join(config.root, 'android/apk-templates/domains.json'), 'utf8'),
    );
    let value = Object.hasOwn(aliases, input) ? aliases[input] : input;
    if (!value.includes('://')) {
        if (!value.includes('.'))
            throw fail(422, '域名简称尚未配置；请填写完整 HTTPS 域名或选择 local');
        value = `https://${value}`;
    }
    let u;
    try {
        u = new URL(value);
    } catch {
        throw fail(422, '后台域名格式无效');
    }
    if (
        (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== '/'
    )
        throw fail(
            422,
            '后台地址应为 HTTPS 域名，不带路径、凭证或查询参数；本机允许 http://127.0.0.1:端口',
        );
    return u.origin;
}
