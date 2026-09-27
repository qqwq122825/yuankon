import path from 'node:path';
import sharp from 'sharp';
import { realpath, stat, open } from 'node:fs/promises';
import { fail } from './protocol.js';
export async function privateFile(root, relative, prefix) {
    if (
        typeof relative !== 'string' ||
        !relative.startsWith(prefix) ||
        relative.includes('\\') ||
        relative.split('/').includes('..')
    )
        throw fail(404, '文件不存在');
    try {
        const base = await realpath(root);
        const target = await realpath(path.resolve(root, relative));
        const permitted = path.resolve(base, prefix);
        if (
            !target.startsWith(permitted + path.sep) ||
            !target.startsWith(base + path.sep) ||
            !(await stat(target)).isFile()
        )
            throw new Error();
        return target;
    } catch {
        throw fail(404, '文件不存在');
    }
}
export async function checkPng(filename) {
    const file = await open(filename, 'r');
    try {
        const header = Buffer.alloc(24);
        await file.read(header, 0, 24, 0);
        const size = (await file.stat()).size;
        if (
            size > 8 * 1024 * 1024 ||
            !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            header.toString('ascii', 12, 16) !== 'IHDR'
        )
            throw new Error();
        const w = header.readUInt32BE(16),
            h = header.readUInt32BE(20);
        if (!w || !h || w > 10000 || h > 10000 || w * h > 20000000) throw new Error();
        return await sharp(filename, { limitInputPixels: 20000000, failOn: 'warning' })
            .png()
            .toBuffer();
    } catch {
        throw fail(422, '截图文件校验失败');
    } finally {
        await file.close();
    }
}
