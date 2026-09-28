// Browser-test transport fixture only: these bytes are not a compiled Android package.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const buildFixture = {
    readiness: async () => ({ ready: true, message: '本地队列 UI 测试夹具 · Telegram 发送待接入' }),
    runner: async (config, job, _template, { stage }) => {
        const logDirectory = path.join(config.privateDir, 'build-work', job.id);
        await mkdir(logDirectory, { recursive: true });
        await writeFile(
            path.join(logDirectory, 'build.log'),
            [
                `[BUILD] START id=${job.id} role=${job.artifact_role}`,
                '[STAGE:preparing] synthetic source copy',
                '[COMMAND:GRADLE_ASSEMBLE_LINT] OK',
                '[STAGE:signing] verify APK development signature',
                '[COMMAND:APKSIGNER_VERIFY] OK',
                '[STAGE:aligning] verify APK alignment',
                '[COMMAND:ZIPALIGN_VERIFY] OK',
                '[COMMAND:AAPT_BADGING] OK',
                '[BUILD] SUCCEEDED',
            ].join('\n'),
        );
        await stage('compiling');
        await new Promise((r) => setTimeout(r, 200));
        if (job.batch === 'FAIL') throw new Error('Intentional test failure');
        const data = Buffer.from('SYNTHETIC-BROWSER-DOWNLOAD-NOT-APK');
        const artifact_path = `apk-builds/${job.id}/application.apk`;
        await mkdir(path.join(config.privateDir, 'files', path.dirname(artifact_path)), {
            recursive: true,
        });
        await writeFile(path.join(config.privateDir, 'files', artifact_path), data);
        return {
            artifact_path,
            size: data.length,
            sha256: createHash('sha256').update(data).digest('hex'),
        };
    },
};
