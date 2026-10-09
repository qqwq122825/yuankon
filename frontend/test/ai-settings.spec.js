import { test, expect } from '@playwright/test';

const providers = ['通义千问', 'DeepSeek', 'OpenAI', '硅基流动', '自定义'];
const cardTitles = [
    '启用 AI',
    '选择提供商',
    '连接参数',
    '分析提示词',
    '分析参数',
    '分析策略',
    'AI 权限（已锁定）',
];
const defaultPrompt =
    '请根据以下合成短信样本整理金融相关事实，区分已知信息与未知信息，列出金额、时间和类型，不推断信用资格或提供投资决策。\n\n短信样本：\n{{SMS}}';
const checkboxDefaults = [
    { name: '启用 AI 金融分析', checked: false },
    { name: '收到短信后自动分析（关闭后仅可在设备页手动触发）', checked: false },
    { name: '分析「已开启无障碍」的设备', checked: true },
    { name: '分析「未开启无障碍」的设备', checked: false },
    { name: '无短信缓存时自动拉取短信，获取后再分析', checked: false },
];
const numericFields = [
    { name: '分析短信条数', id: 'ai-sms-count', value: '50', min: '10', max: '200', step: '1' },
    { name: '最少短信条数', id: 'ai-minimum-sms', value: '10', min: '1', max: '50', step: '1' },
    {
        name: '最短分析间隔（分钟）',
        id: 'ai-interval',
        value: '60',
        min: '5',
        max: '1440',
        step: '1',
    },
    { name: '分析后多少天可再分析', id: 'ai-cooldown', value: '7', min: '0', step: '1' },
    { name: 'Temperature', id: 'ai-temperature', value: '0.3', min: '0', max: '2', step: '0.1' },
    { name: 'Max Tokens', id: 'ai-max-tokens', value: '2048', min: '1', step: '1' },
];

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function openAI(page) {
    const link = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', {
        name: 'AI',
        exact: true,
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ai');
    await expect(page.getByRole('heading', { name: 'AI 配置', exact: true })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
}

async function expectPreview(page) {
    await expect(page.getByTestId('ai-connection-status')).toHaveText('未验证 · UI预览');
    await expect(page.getByTestId('ai-last-saved')).toHaveText('—');
    await expect(page.locator('#ai-key-hint')).toHaveText('尚未保存密钥');
    await expect(page.getByText('已验证', { exact: true })).toHaveCount(0);
    await expect(page.getByText('保存成功', { exact: true })).toHaveCount(0);
}

async function expectDefaults(page) {
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(
        'https://api.deepseek.com',
    );
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('模型名', { exact: true })).toHaveValue('deepseek-chat');
    await expect(page.getByRole('textbox', { name: '分析提示词', exact: true })).toHaveValue(
        defaultPrompt,
    );
    for (const entry of checkboxDefaults) {
        const checkbox = page.getByRole('checkbox', { name: entry.name, exact: true });
        await expect(checkbox).toHaveCount(1);
        await expect(checkbox).toBeChecked({ checked: entry.checked });
    }
    for (const entry of numericFields)
        await expect(page.locator(`#${entry.id}`)).toHaveValue(entry.value);
    await expect(
        page.getByRole('group', { name: 'AI 服务商', exact: true }).getByRole('button', {
            name: 'DeepSeek',
            exact: true,
        }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expectPreview(page);
}

async function geometry(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return { ...box, right: box.x + box.width, center: box.x + box.width / 2 };
}

async function expectCentered(page) {
    const main = await geometry(page.locator('.console-main'));
    const wrapper = page.locator('.ai-settings-page.settings-page--centered');
    const title = await geometry(wrapper.locator(':scope > .page-title-row'));
    expect((await geometry(wrapper)).width).toBeCloseTo(810, 0);
    expect(title.width).toBeCloseTo(750, 0);
    expect(Math.abs(title.center - main.center)).toBeLessThanOrEqual(1);
    const cards = wrapper.locator(':scope > .settings-card');
    await expect(cards).toHaveCount(7);
    for (const card of await cards.all()) {
        const box = await geometry(card);
        expect(box.width).toBeCloseTo(750, 0);
        expect(Math.abs(box.x - title.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.right - title.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.center - main.center)).toBeLessThanOrEqual(1);
    }
}

async function storageSnapshot(page) {
    return page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
}

test('AI configuration exposes seven centered preview cards, all fields and five local provider choices', async ({
    page,
}) => {
    await login(page);
    await openAI(page);
    const wrapper = page.locator('.ai-settings-page');
    await expect(wrapper.locator(':scope > .settings-card h2')).toHaveText(cardTitles);
    await expectCentered(page);
    await expectDefaults(page);
    await expect(wrapper.locator('.ai-preview-banner')).toContainText('功能待接入');
    await expect(wrapper.locator('.ai-introduction')).toContainText('每个登录账号使用自己的 AI');
    const key = page.getByLabel('API Key', { exact: true });
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveAttribute('autocomplete', 'off');
    await expect(key).toHaveAttribute('aria-describedby', 'ai-key-hint');
    const enable = page.getByRole('checkbox', { name: '启用 AI 金融分析', exact: true });
    await enable.check();
    await expect(enable).toBeChecked();
    await expectPreview(page);
    await enable.uncheck();
    const row = wrapper.locator('.ai-enable-row');
    const checkboxBox = await geometry(row.locator('label'));
    const statusBox = await geometry(page.getByTestId('ai-connection-status'));
    expect(
        Math.abs(checkboxBox.y + checkboxBox.height / 2 - statusBox.y - statusBox.height / 2),
    ).toBeLessThanOrEqual(1);
    const connectionFields = page.locator('.ai-connection-fields .form-control');
    await expect(connectionFields).toHaveCount(3);
    const connectionBoxes = await Promise.all((await connectionFields.all()).map(geometry));
    for (const box of connectionBoxes) {
        expect(box.width).toBeCloseTo(connectionBoxes[0].width, 0);
        expect(box.x).toBeCloseTo(connectionBoxes[0].x, 0);
    }
    expect(connectionBoxes[1].y).toBeGreaterThan(connectionBoxes[0].y + connectionBoxes[0].height);
    expect(connectionBoxes[2].y).toBeGreaterThan(connectionBoxes[1].y + connectionBoxes[1].height);
    const choices = page.getByRole('group', { name: 'AI 服务商', exact: true });
    await expect(choices.getByRole('button')).toHaveText(providers);
    for (const name of providers) {
        await choices.getByRole('button', { name, exact: true }).click();
        for (const candidate of providers)
            await expect(
                choices.getByRole('button', { name: candidate, exact: true }),
            ).toHaveAttribute('aria-pressed', String(candidate === name));
        const guide = page.getByRole('complementary', { name: `${name} 接入指南`, exact: true });
        await expect(guide).toBeVisible();
        await expect(
            guide.getByRole('heading', { name: `${name} 配置引导`, exact: true }),
        ).toBeVisible();
        await expect(key).toHaveValue('');
        await expectPreview(page);
        if (name === 'DeepSeek') {
            await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(
                'https://api.deepseek.com',
            );
            await expect(page.getByLabel('模型名', { exact: true })).toHaveValue('deepseek-chat');
            for (const linkName of ['DeepSeek API Keys', '打开官方文档获取 API Key →']) {
                const link = guide.getByRole('link', { name: linkName, exact: true });
                await expect(link).toHaveAttribute(
                    'href',
                    'https://platform.deepseek.com/api_keys',
                );
                await expect(link).toHaveAttribute('target', '_blank');
                await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
            }
        } else {
            await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('');
            await expect(page.getByLabel('模型名', { exact: true })).toHaveValue('');
            await expect(guide).toContainText('本页仅展示字段');
        }
    }
    await choices.getByRole('button', { name: 'DeepSeek', exact: true }).click();
    await expectDefaults(page);
    console.log(
        'AI_FIELDS PASS: seven 750px centered cards; all fields/defaults; five aria-pressed provider choices; DeepSeek guide links; enable local-only; status unverified/date dash/key empty',
    );
});

test('AI draft fields, numeric constraints, default prompt and advanced disclosure support keyboard editing', async ({
    page,
}) => {
    await login(page);
    await openAI(page);
    await expectDefaults(page);
    await page.getByLabel('Base URL', { exact: true }).fill('https://example.com/ui-fixture');
    await page.getByLabel('模型名', { exact: true }).fill('ui-fixture-model');
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(
        'https://example.com/ui-fixture',
    );
    await expect(page.getByLabel('模型名', { exact: true })).toHaveValue('ui-fixture-model');
    const prompt = page.getByRole('textbox', { name: '分析提示词', exact: true });
    await prompt.fill('合成 UI 样本：{{SMS}}，仅用于字段编辑测试。');
    await expect(prompt).toHaveValue('合成 UI 样本：{{SMS}}，仅用于字段编辑测试。');
    const restore = page.getByRole('button', { name: '恢复默认', exact: true });
    await restore.focus();
    await expect(restore).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveValue(defaultPrompt);
    expect(await prompt.inputValue()).toContain('{{SMS}}');
    for (const entry of checkboxDefaults) {
        const checkbox = page.getByRole('checkbox', { name: entry.name, exact: true });
        await checkbox.focus();
        await expect(checkbox).toBeFocused();
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked({ checked: !entry.checked });
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked({ checked: entry.checked });
    }
    const advanced = page.locator('.ai-advanced');
    const summary = advanced.locator('summary');
    await expect(summary).toHaveText('高级参数');
    await expect(page.locator('#ai-temperature')).not.toBeVisible();
    await expect(page.locator('#ai-max-tokens')).not.toBeVisible();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(advanced).toHaveAttribute('open', '');
    for (const entry of numericFields) {
        const field = page.getByRole('spinbutton', { name: entry.name, exact: true });
        await expect(field).toHaveAttribute('id', entry.id);
        await expect(field).toHaveValue(entry.value);
        await expect(field).toHaveAttribute('min', entry.min);
        await expect(field).toHaveAttribute('step', entry.step);
        if (entry.max) await expect(field).toHaveAttribute('max', entry.max);
        else expect(await field.getAttribute('max')).toBeNull();
        await field.fill(String(Number(entry.min) - Number(entry.step)));
        expect(await field.evaluate((input) => input.validity.rangeUnderflow)).toBe(true);
        await field.fill(entry.min);
        expect(await field.evaluate((input) => input.validity.valid)).toBe(true);
        if (entry.max) {
            await field.fill(String(Number(entry.max) + Number(entry.step)));
            expect(await field.evaluate((input) => input.validity.rangeOverflow)).toBe(true);
            await field.fill(entry.max);
            expect(await field.evaluate((input) => input.validity.valid)).toBe(true);
        }
        await field.fill(entry.value);
    }
    const temperature = page.getByRole('spinbutton', { name: 'Temperature', exact: true });
    await temperature.fill('0.35');
    expect(await temperature.evaluate((input) => input.validity.stepMismatch)).toBe(true);
    await temperature.fill('0.3');
    await summary.focus();
    await page.keyboard.press('Enter');
    expect(await advanced.getAttribute('open')).toBeNull();
    await expect(temperature).not.toBeVisible();
    await expectPreview(page);
    console.log(
        'AI_DRAFT PASS: editable URL/model/prompt; literal SMS placeholder/default restoration; checkbox defaults/toggles; numeric min/max/step validation; native advanced keyboard open/close; preview unchanged',
    );
});

test('AI actions only display pending notices and never persist or transmit a synthetic key; navigation and reload reset drafts', async ({
    page,
}) => {
    let observing = false;
    const requests = [];
    const frames = [];
    page.on('request', (request) => {
        if (observing)
            requests.push({
                url: request.url(),
                method: request.method(),
                body: request.postData() || '',
            });
    });
    page.on('websocket', (socket) =>
        socket.on('framesent', (event) => {
            if (observing) frames.push(String(event.payload));
        }),
    );
    await login(page);
    const origin = new URL(page.url()).origin;
    observing = true;
    await openAI(page);
    const initialStorage = await storageSnapshot(page);
    const keyValue = 'ui-only-fixture-key';
    const key = page.getByLabel('API Key', { exact: true });
    await key.fill(keyValue);
    await page.getByLabel('Base URL', { exact: true }).fill('https://example.com/ui-only-fixture');
    await page.getByLabel('模型名', { exact: true }).fill('ui-only-fixture-model');
    await page.getByRole('checkbox', { name: '启用 AI 金融分析', exact: true }).check();
    await page.getByRole('spinbutton', { name: '分析短信条数', exact: true }).fill('75');
    const actions = [
        { name: '验证密钥', action: '验证' },
        { name: '保存配置', action: '保存' },
        { name: '删除配置', action: '删除' },
    ];
    for (const action of actions) {
        const button = page.getByRole('button', { name: action.name, exact: true });
        await button.focus();
        await expect(button).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status')).toHaveText(`界面预览，${action.action}接口待接入。`);
        await expect(key).toHaveValue(keyValue);
        await expectPreview(page);
        expect(await storageSnapshot(page)).toEqual(initialStorage);
    }
    await page.getByRole('link', { name: '返回设备', exact: true }).click();
    await expect(page).toHaveURL('/');
    await openAI(page);
    await expectDefaults(page);
    await expect(page.locator('.ai-action-notice')).toHaveCount(0);
    await key.fill(keyValue);
    await page
        .getByRole('group', { name: 'AI 服务商', exact: true })
        .getByRole('button', {
            name: '自定义',
            exact: true,
        })
        .click();
    await page
        .getByLabel('Base URL', { exact: true })
        .fill('https://example.com/custom-ui-fixture');
    await page.getByLabel('模型名', { exact: true }).fill('custom-ui-fixture-model');
    await page.getByRole('checkbox', { name: '启用 AI 金融分析', exact: true }).check();
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    const document = await page.reload();
    expect(document.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'AI 配置', exact: true })).toBeVisible();
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
    await expectDefaults(page);
    await expect(page.locator('.ai-action-notice')).toHaveCount(0);
    expect(await storageSnapshot(page)).toEqual(initialStorage);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
        const url = new URL(request.url);
        expect(url.origin).toBe(origin);
        expect(request.method).toBe('GET');
        expect(url.pathname).not.toMatch(
            /^\/api\/(?:ai|settings\/ai|injection|push|performance)(?:\/|$)/,
        );
        expect(`${request.url}\n${request.body}`).not.toContain(keyValue);
    }
    for (const payload of frames) {
        expect(payload).not.toContain(keyValue);
        expect(['get_bot_list', 'subscribe', 'unsubscribe', 'ping']).toContain(
            JSON.parse(payload).type,
        );
    }
    expect(JSON.stringify(await storageSnapshot(page))).not.toContain(keyValue);
    console.log(
        'AI_PREVIEW_ACTIONS PASS: verify/save/delete pending notices only; synthetic key excluded from HTTP/WS/storage; same-origin GET only; no module APIs or device commands; route departure and reload reset every draft',
    );
});

test('AI cards retain desktop centering, focus, scrolling and a fixed rail in light/dark wide and narrow windows', async ({
    page,
}) => {
    await login(page);
    await openAI(page);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByRole('button', { name: '切换明暗主题' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1920, 1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.scrollTo(0, 0));
            await expectCentered(page);
            const rail = page.locator('.console-rail');
            const initialRail = await rail.boundingBox();
            expect(initialRail.x).toBe(0);
            expect(initialRail.y).toBe(58);
            expect(initialRail.width).toBe(width >= 1800 ? 64 : 56);
            expect(initialRail.height).toBe(842);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            const choice = page
                .getByRole('group', { name: 'AI 服务商', exact: true })
                .getByRole('button', {
                    name: 'DeepSeek',
                    exact: true,
                });
            await choice.focus();
            await expect(choice).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(choice).toHaveAttribute('aria-pressed', 'true');
            const key = page.getByLabel('API Key', { exact: true });
            await key.focus();
            await expect(key).toBeFocused();
            await expect(key).toHaveAttribute('type', 'password');
            await page.evaluate(() => window.scrollTo(400, document.documentElement.scrollHeight));
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            if (width === 800)
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
            expect(await rail.boundingBox()).toEqual(initialRail);
            expect(
                await page.evaluate(() =>
                    Boolean(document.elementFromPoint(28, 80)?.closest('.console-rail')),
                ),
            ).toBe(true);
            await expectCentered(page);
            const back = page.getByRole('link', { name: '返回设备', exact: true });
            await back.focus();
            await expect(back).toBeFocused();
            expect(await rail.boundingBox()).toEqual(initialRail);
            await expectPreview(page);
            await page.evaluate(() => window.scrollTo(0, 0));
            if (width === 1920 || width === 800)
                await page.screenshot({
                    path: `test-results/ai-settings-${theme}-${width}.png`,
                    fullPage: true,
                });
        }
    }
    await page.getByRole('link', { name: '返回设备', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
    await expect(
        page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', {
            name: '设备',
            exact: true,
        }),
    ).toHaveAttribute('aria-current', 'page');
    console.log(
        'AI_GEOMETRY PASS: light/dark 1920/1440/1280/800; seven 750px cards/title/main aligned; 1280px minimum canvas; vertical/horizontal scrolling; fixed 56/64px rail; keyboard focus/return; four screenshots',
    );
});
