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
export async function checkToolDetails(config) {
    const t = toolchain(config);
    const components = [
        { id: 'java', label: 'JDK 17', target: t.java, mode: constants.X_OK },
        { id: 'gradle', label: 'Gradle 8.11.1', target: t.gradle, mode: constants.X_OK },
        { id: 'apksigner', label: 'Android apksigner', target: t.signer, mode: constants.X_OK },
        { id: 'zipalign', label: 'Android zipalign', target: t.align, mode: constants.X_OK },
        { id: 'aapt', label: 'Android aapt', target: t.aapt, mode: constants.X_OK },
        {
            id: 'platform',
            label: 'Android SDK Platform 35',
            target: path.join(t.sdk, 'platforms/android-35/android.jar'),
        },
        {
            id: 'cache',
            label: 'Gradle 离线依赖缓存',
            target: path.join(
                t.env.GRADLE_USER_HOME,
                'caches/modules-2/files-2.1/com.android.tools.build/gradle/8.9.2',
            ),
        },
    ];
    return Promise.all(
        components.map(async ({ target, mode, ...component }) => {
            try {
                await access(target, mode);
                return { ...component, ready: true };
            } catch {
                return { ...component, ready: false };
            }
        }),
    );
}
export async function checkTools(config) {
    const components = await checkToolDetails(config),
        ready = components.every((component) => component.ready);
    return {
        ready,
        components,
        message: ready
            ? '本地单任务队列 · 开发签名 APK · Telegram 发送待接入'
            : '本地 Android 工具链未就绪，请在安装页准备 JDK、SDK、Gradle 与离线缓存',
    };
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
export async function fileSha256(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

export async function prepareSource(config, job, template, destination, { payloadFile } = {}) {
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
        ...(template.kind === 'screenagent' && xml.includes('name="accessibility_service_name"')
            ? { accessibility_service_name: job.app_name }
            : {}),
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
    if (template.kind === 'installer') {
        if (
            !payloadFile ||
            !job.payload_build_id ||
            !job.payload_sha256 ||
            !job.payload_package_name
        )
            throw new Error('Installer payload is missing');
        if ((await fileSha256(payloadFile)) !== job.payload_sha256)
            throw new Error('Installer payload digest mismatch');
        await copyFile(payloadFile, path.join(assets, 'payload.apk'));
        await writeFile(
            path.join(assets, 'installer_config.json'),
            JSON.stringify(
                {
                    payloadBuildId: job.payload_build_id,
                    payloadSha256: job.payload_sha256,
                    payloadPackageName: job.payload_package_name,
                    homeUrl: job.home_url,
                },
                null,
                2,
            ),
        );
        const manifestPath = path.join(destination, 'app/src/main/AndroidManifest.xml');
        const manifest = await readFile(manifestPath, 'utf8');
        if (manifest.includes('__PAYLOAD_PACKAGE_NAME__'))
            await writeFile(
                manifestPath,
                manifest.replaceAll('__PAYLOAD_PACKAGE_NAME__', job.payload_package_name),
            );
        return;
    }
    const values = {
        serverUrl: job.backend_url.replace(/^http/, 'ws'),
        ...(template.kind === 'browser' ? { webUrl: job.home_url } : {}),
        apkId: job.apk_id,
        batch: job.batch,
        buildId: job.id,
        appName: job.app_name,
        packageName: job.package_name,
        version: template.versionName,
        domain: job.domain,
        ...(template.kind === 'screenagent' && template.capture
            ? { capture: template.capture }
            : {}),
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

export async function runLoggedTool(label, file, args, options) {
    options.log(
        `[${new Date().toISOString()}] [COMMAND:${label}] START ${JSON.stringify([file, ...args])}\n`,
    );
    try {
        const output = await runTool(file, args, options);
        options.log(`[${new Date().toISOString()}] [COMMAND:${label}] OK\n`);
        return output;
    } catch (error) {
        options.log(`[${new Date().toISOString()}] [COMMAND:${label}] FAILED\n`);
        throw error;
    }
}

export async function buildApk(config, job, template, { signal, stage, payloadFile }) {
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
    const logLine = (message) => log(`[${new Date().toISOString()}] ${message}\n`);
    const setStage = async (value, detail) => {
        logLine(`[STAGE:${value}] ${detail}`);
        await stage(value);
    };
    const t = toolchain(config),
        options = { cwd: folder, env: t.env, signal, log };
    try {
        logLine(
            `[BUILD] START id=${job.id} role=${job.artifact_role || 'standalone'} template=${template.id} sourceDir=${template.sourceDir}`,
        );
        logLine(
            `[IDENTITY] package=${job.package_name} versionName=${template.versionName} versionCode=${template.versionCode}`,
        );
        if (template.kind === 'installer')
            logLine(
                `[PAYLOAD] buildId=${job.payload_build_id} package=${job.payload_package_name} sha256=${job.payload_sha256}`,
            );
        if (!(await checkTools(config)).ready) throw new Error('Missing build tools');
        await setStage('preparing', 'copy registered template and inject validated configuration');
        await prepareSource(config, job, template, source, { payloadFile });
        await setStage('compiling', 'assemble debug APK and run Android Lint');
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
        await runLoggedTool(
            'GRADLE_ASSEMBLE_LINT',
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
        const apk = path.join(source, 'app/build/outputs/apk/debug/app-debug.apk');
        const size = (await stat(apk)).size;
        if (size < 1000 || size > 150 * 1024 * 1024) throw new Error('Invalid APK size');
        logLine(`[APK] compiled size=${size}`);
        await setStage('signing', 'verify APK development signature');
        await runLoggedTool('APKSIGNER_VERIFY', t.signer, ['verify', '--verbose', apk], options);
        await setStage('aligning', 'verify 4-byte and 16 KiB page alignment');
        await runLoggedTool('ZIPALIGN_VERIFY', t.align, ['-c', '-P', '16', '4', apk], options);
        await setStage('inspecting', 'read package, version and launcher metadata');
        const metadata = await runLoggedTool(
            'AAPT_BADGING',
            t.aapt,
            ['dump', 'badging', apk],
            options,
        );
        if (
            !metadata.includes(`package: name='${job.package_name}'`) ||
            !metadata.includes(`versionName='${template.versionName}'`) ||
            !metadata.includes(`versionCode='${template.versionCode}'`)
        )
            throw new Error('APK identity mismatch');
        const hasLauncher = metadata.includes('launchable-activity:');
        if (template.kind === 'screenagent' && hasLauncher)
            throw new Error('B package unexpectedly exposes a launcher activity');
        if (template.kind !== 'screenagent' && !hasLauncher)
            throw new Error('Visible package is missing its launcher activity');
        logLine(
            `[ROLE] launcher=${hasLauncher} expected=${template.kind === 'screenagent' ? 'absent' : 'present'}`,
        );
        const sha256 = await fileSha256(apk);
        logLine(`[APK] sha256=${sha256}`);
        const artifact_path = `apk-builds/${job.id}/application.apk`;
        const output = path.join(config.privateDir, 'files', artifact_path);
        await setStage('publishing', 'copy verified APK to authenticated artifact storage');
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        if (signal.aborted) throw new Error('Build interrupted');
        await copyFile(apk, output);
        logLine(`[BUILD] SUCCEEDED artifact=${artifact_path} size=${size} sha256=${sha256}`);
        return { artifact_path, size, sha256 };
    } catch (error) {
        logLine(`[BUILD] FAILED name=${error.name} message=${error.message}`);
        throw error;
    } finally {
        logLine('[CLEANUP] remove private source copy');
        logStream.end();
        await finished(logStream);
        await rm(source, { recursive: true, force: true });
    }
}
