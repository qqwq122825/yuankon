import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { access, chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/config.js';

async function run(command, args, options) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'boundary-install-'));
    await mkdir(path.join(root, 'backend'), { recursive: true });
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await cp(path.join(ROOT, 'install.sh'), path.join(root, 'install.sh'));
    const npm = path.join(root, 'bin/npm');
    await writeFile(
        npm,
        `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$PWD/npm.calls"
case "$*" in
  'run build') mkdir -p frontend/dist; printf '<!doctype html>' > frontend/dist/index.html ;;
  '--prefix backend run initialize')
    mkdir -p backend/.node-private
    printf fixture > backend/.node-private/boundary.sqlite
    printf 12345678901234567890123456789012 > backend/.node-private/master.key
    ;;
esac
`,
    );
    await chmod(npm, 0o755);
    return root;
}

test('install bootstrap prepares runtime and leaves account creation to the web installer', async () => {
    const root = await fixture();
    try {
        const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
        const first = await run(
            'sh',
            [
                path.join(root, 'install.sh'),
                '--origin',
                'https://panel.example.test',
                '--port',
                '8081',
                '--trust-proxy',
            ],
            { cwd: root, env },
        );
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stdout, /BOOTSTRAP_OK origin=https:\/\/panel\.example\.test port=8081/);
        assert.match(first.stdout, /next=https:\/\/panel\.example\.test\/install/);
        assert.equal(
            await readFile(path.join(root, 'backend/.env'), 'utf8'),
            'NODE_PUBLIC_ORIGIN=https://panel.example.test\nNODE_PORT=8081\nNODE_TRUST_PROXY=1\n',
        );
        const lock = JSON.parse(
            await readFile(path.join(root, 'backend/.node-private/bootstrap.lock'), 'utf8'),
        );
        assert.deepEqual(
            { ...lock, preparedAt: '<time>' },
            {
                schemaVersion: 1,
                preparedAt: '<time>',
                origin: 'https://panel.example.test',
                port: 8081,
                trustProxy: true,
                commit: 'unavailable',
            },
        );
        assert.match(lock.preparedAt, /^\d{4}-\d{2}-\d{2}T/);
        await assert.rejects(() => access(path.join(root, 'backend/.node-private/install.lock')));
        assert.equal(
            await readFile(path.join(root, 'npm.calls'), 'utf8'),
            'ci\nrun build\n--prefix backend run initialize\n',
        );
        await access(path.join(root, 'frontend/dist/index.html'));

        const second = await run('sh', [path.join(root, 'install.sh')], { cwd: root, env });
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /BOOTSTRAP_ALREADY_COMPLETE/);
        assert.equal(
            await readFile(path.join(root, 'npm.calls'), 'utf8'),
            'ci\nrun build\n--prefix backend run initialize\n',
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('install bootstrap rejects invalid origin before running npm', async () => {
    const root = await fixture();
    try {
        const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
        const result = await run(
            'sh',
            [path.join(root, 'install.sh'), '--origin', 'https://panel.example.test/path'],
            { cwd: root, env },
        );
        assert.notEqual(result.status, 0);
        await assert.rejects(() => access(path.join(root, 'npm.calls')));
        await assert.rejects(() => access(path.join(root, 'backend/.node-private/bootstrap.lock')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Android environment installer helpers work with nounset enabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'boundary-environment-helpers-'));
    try {
        const script = await readFile(
            path.join(ROOT, 'android/scripts/install-build-environment.sh'),
            'utf8',
        );
        const helpers = script.split('\ncleanup()')[0];
        const harness = `${helpers}
mkdir -p "$DOWNLOADS" "$STAGING/source"
printf fixture > "$DOWNLOADS/cached.bin"
expected="$(sha256 "$DOWNLOADS/cached.bin")"
download cached.bin https://invalid.example.test/file "$expected"
printf source > "$STAGING/source/value"
replace_dir "$STAGING/source" "$STAGING/target"
test "$(cat "$STAGING/target/value")" = source
printf 'ENVIRONMENT_HELPERS_OK\\n'
`;
        const result = await run('bash', ['-c', harness], {
            cwd: root,
            env: {
                ...process.env,
                BOUNDARY_ROOT: root,
                BOUNDARY_PRIVATE_DIR: path.join(root, 'private'),
                BOUNDARY_NODE: process.execPath,
            },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /\[CACHE\] cached\.bin/);
        assert.match(result.stdout, /ENVIRONMENT_HELPERS_OK/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
