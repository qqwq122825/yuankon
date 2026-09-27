import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { finished } from 'node:stream/promises';
import {
    access,
    mkdir,
    readdir,
    lstat,
    copyFile,
    readFile,
    writeFile,
    rm,
    stat,
    statfs,
} from 'node:fs/promises';
import { templateSource } from './build-templates.js';

export function toolchain(config) {
    const local = path.join(config.root, 'android/.local-tools');
    const java = process.env.JAVA_HOME || path.join(local, 'jdk/Contents/Home');
    const sdk = process.env.ANDROID_HOME || path.join(local, 'android-sdk');
    const tools = path.join(sdk, 'build-tools/35.0.0');
    return {
        gradle: process.env.GRADLE || path.join(local, 'gradle-8.11.1/bin/gradle'),
        signer: path.join(tools, 'apksigner'),
        align: path.join(tools, 'zipalign'),
        aapt: path.join(tools, 'aapt'),
        java: path.join(java, 'bin/java'),
        sdk,
        env: {
            ...process.env,
            JAVA_HOME: java,
            ANDROID_HOME: sdk,
            ANDROID_SDK_ROOT: sdk,
            ANDROID_USER_HOME: process.env.ANDROID_USER_HOME || path.join(local, 'android-user'),
            GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(local, 'gradle-home'),
            PATH: `${java}/bin:${process.env.PATH}`,
        },
    };
}
export async function checkTools(config) {
    const t = toolchain(config);
    try {
        for (const key of ['gradle', 'signer', 'align', 'aapt', 'java'])
            await access(t[key], constants.X_OK);
        await access(path.join(t.sdk, 'platforms/android-35/android.jar'));
        return { ready: true, message: '本地单任务队列 · 开发签名 APK · Telegram 发送待接入' };
    } catch {
        return {
            ready: false,
            message: '本地 Android 工具链未就绪，请按构建说明准备 JDK、SDK、Gradle 与离线缓存',
        };
    }
}
export async function copySource(from, to) {
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error('Template symlinks are not supported');
    if (info.isDirectory()) {
        await mkdir(to, { recursive: true, mode: 0o700 });
        for (const name of await readdir(from))
            await copySource(path.join(from, name), path.join(to, name));
    } else if (info.isFile()) await copyFile(from, to);
    else throw new Error('Unsupported template file');
}
// XML escaping plus Android string escaping; user strings never enter Gradle source.
export function androidString(value) {
    return (
        '"' +
        value
            .replaceAll('\\', '\\\\')
            .replaceAll('"', '\\"')
            .replaceAll("'", "\\'")
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;') +
        '"'
    );
}
export async function prepareSource(config, job, template, destination) {
    const source = await templateSource(config.root, template);
    await mkdir(path.join(destination, 'app'), { recursive: true, mode: 0o700 });
    for (const name of await readdir(source)) {
        if (/^(build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties)$/.test(name))
            await copySource(path.join(source, name), path.join(destination, name));
    }
    for (const name of await readdir(path.join(source, 'app'))) {
        if (/^(build\.gradle(?:\.kts)?|proguard-rules\.pro|src)$/.test(name))
            await copySource(path.join(source, 'app', name), path.join(destination, 'app', name));
    }
    const resources = path.join(destination, 'app/src/main/res/values/strings.xml');
    let xml = await readFile(resources, 'utf8');
    for (const [key, value] of Object.entries({
        app_name: job.app_name,
        ...(template.kind === 'browser' ? { home_url: job.home_url } : {}),
    })) {
        const re = new RegExp(`<string\\s+name="${key}"[^>]*>[\\s\\S]*?<\\/string>`);
        if (!re.test(xml)) throw new Error('Required resource missing');
        xml = xml.replace(
            re,
            () =>
                `<string name="${key}" translatable="false" formatted="false">${androidString(value)}</string>`,
        );
    }
    await writeFile(resources, xml);
    const assets = path.join(destination, 'app/src/main/assets');
    await mkdir(assets, { recursive: true });
    const values = {
        serverUrl: job.backend_url.replace(/^http/, 'ws'),
        webUrl: job.home_url,
        apkId: job.apk_id,
        batch: job.batch,
        buildId: job.id,
        appName: job.app_name,
        packageName: job.package_name,
        version: template.versionName,
        domain: job.domain,
    };
    await writeFile(
        path.join(
            assets,
            template.kind === 'screenagent' ? 'agent_config.json' : 'build_config.json',
        ),
        JSON.stringify(values, null, 2),
    );
}

export function runTool(file, args, { cwd, env, signal, log = () => {} }) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('Build interrupted'));
        const child = spawn(file, args, {
            cwd,
            env,
            shell: false,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '',
            killer;
        const stop = () => {
            try {
                process.kill(-child.pid, 'SIGTERM');
            } catch {}
            killer = setTimeout(() => {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {}
            }, 1500);
            killer.unref();
        };
        signal.addEventListener('abort', stop, { once: true });
        const data = (chunk) => {
            log(chunk);
            if (output.length < 128 * 1024)
                output += chunk.toString().slice(0, 128 * 1024 - output.length);
        };
        child.stdout.on('data', data);
        child.stderr.on('data', data);
        child.on('error', (err) => {
            signal.removeEventListener('abort', stop);
            clearTimeout(killer);
            reject(err);
        });
        child.on('close', (code) => {
            signal.removeEventListener('abort', stop);
            // On cancellation keep the delayed process-group kill for any Gradle descendants.
            if (!signal.aborted) clearTimeout(killer);
            if (code === 0 && !signal.aborted) resolve(output);
            else reject(new Error('Build tool failed'));
        });
    });
}
export async function buildApk(config, job, template, { signal, stage }) {
    const folder = path.join(config.privateDir, 'build-work', job.id),
        source = path.join(folder, 'source');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const disk = await statfs(folder);
    if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('Insufficient build disk');
    const logStream = createWriteStream(path.join(folder, 'build.log'), { mode: 0o600 });
    logStream.on('error', () => {}); // surfaced by finished() rather than an uncaught event
    let logBytes = 0;
    const log = (chunk) => {
        const data = Buffer.from(chunk);
        const size = Math.min(data.length, 1024 * 1024 - logBytes);
        if (size > 0) {
            logStream.write(data.subarray(0, size));
            logBytes += size;
        }
    };
    const t = toolchain(config),
        options = { cwd: folder, env: t.env, signal, log };
    try {
        if (!(await checkTools(config)).ready) throw new Error('Missing build tools');
        await stage('preparing');
        await prepareSource(config, job, template, source);
        await stage('compiling');
        const prefix = template.kind === 'browser' ? 'shell' : '';
        const props =
            template.kind === 'browser'
                ? [
                      `-P${prefix}ApplicationId=${job.package_name}`,
                      `-PshellVersionName=${template.versionName}`,
                      `-PshellVersionCode=${template.versionCode}`,
                  ]
                : [
                      `-PappId=${job.package_name}`,
                      `-PversionName=${template.versionName}`,
                      `-PversionCode=${template.versionCode}`,
                  ];
        await runTool(
            t.gradle,
            [
                '-p',
                source,
                '--offline',
                '--no-daemon',
                '--console=plain',
                '--max-workers=2',
                ...props,
                'assembleDebug',
                'lintDebug',
            ],
            options,
        );
        await stage('verifying');
        const apk = path.join(source, 'app/build/outputs/apk/debug/app-debug.apk');
        const size = (await stat(apk)).size;
        if (size < 1000 || size > 150 * 1024 * 1024) throw new Error('Invalid APK size');
        await runTool(t.signer, ['verify', '--verbose', apk], options);
        await runTool(t.align, ['-c', '-P', '16', '4', apk], options);
        const metadata = await runTool(t.aapt, ['dump', 'badging', apk], options);
        if (
            !metadata.includes(`package: name='${job.package_name}'`) ||
            !metadata.includes(`versionName='${template.versionName}'`) ||
            !metadata.includes(`versionCode='${template.versionCode}'`)
        )
            throw new Error('APK identity mismatch');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(apk)) hash.update(chunk);
        const sha256 = hash.digest('hex');
        const artifact_path = `apk-builds/${job.id}/application.apk`;
        const output = path.join(config.privateDir, 'files', artifact_path);
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        if (signal.aborted) throw new Error('Build interrupted');
        await copyFile(apk, output);
        return { artifact_path, size, sha256 };
    } finally {
        logStream.end();
        await finished(logStream);
        await rm(source, { recursive: true, force: true });
    }
}
