import { test, expect } from '@playwright/test';

async function expectDeviceCountCentered(page) {
    const offsets = await page.locator('.fleet-count').evaluate((count) => {
        const centerY = (element) => {
            const box = element.getBoundingClientRect();
            return box.y + box.height / 2;
        };
        const middle = centerY(count);
        return [...count.children].map((child) => Math.abs(centerY(child) - middle));
    });
    expect(offsets).toHaveLength(2);
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
}

test('reference CSS geometry, header alignment, placeholders and desktop-only layout', async ({
    page,
}) => {
    await page.route('**/api/devices?*perPage=500*', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        // Four clearly marked synthetic records match the reference density, not its data.
        await route.fulfill({ json: { ...json, data: json.data.slice(0, 4), total: 4 } });
    });
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(4);
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await expect(page.locator('.console-header-content')).toHaveCSS('justify-content', 'center');
    await expect(page.locator('.header-stat strong').first()).toHaveCSS('font-size', '15px');
    await expect(page.locator('.header-period-metric strong').first()).toHaveCSS(
        'font-size',
        '13px',
    );
    await expect(page.locator('.rail-link.active > img')).not.toHaveCSS('filter', 'none');
    await expect(page.locator('.rail-link:not(.active) > img').first()).not.toHaveCSS(
        'filter',
        'none',
    );
    for (const size of [
        { width: 1837, height: 905 },
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 800, height: 800 },
    ]) {
        await page.setViewportSize(size);
        const metrics = await page.evaluate(() => {
            const height = (selector) =>
                document.querySelector(selector).getBoundingClientRect().height;
            const header = document.querySelector('.console-topbar');
            const children = [...header.children].map((e) => e.getBoundingClientRect());
            const overlap = children.slice(1).some((r, i) => r.left < children[i].right - 1);
            const table = document.querySelector('.fleet-table');
            return {
                header: height('.console-topbar'),
                toolbar: height('.fleet-toolbar'),
                button: height('.fleet-toolbar .btn'),
                filter: height('.fleet-filter-chip'),
                count: height('.fleet-count'),
                countFont: getComputedStyle(document.querySelector('.fleet-count span')).fontSize,
                countWeight: getComputedStyle(document.querySelector('.fleet-count span'))
                    .fontWeight,
                filterFont: getComputedStyle(document.querySelector('.fleet-filter-chip')).fontSize,
                filterPadding: getComputedStyle(document.querySelector('.fleet-filter-chip'))
                    .padding,
                filterColor: getComputedStyle(document.querySelector('.fleet-filter-chip')).color,
                primaryGap: getComputedStyle(document.querySelector('.fleet-toolbar-primary')).gap,
                toolbarGap: getComputedStyle(document.querySelector('.fleet-toolbar')).gap,
                headingSpacing: getComputedStyle(table.querySelector('th')).letterSpacing,
                heading: height('.fleet-table thead tr'),
                row: height('.fleet-device-row'),
                preview: height('.phone-preview'),
                search: height('.header-search input'),
                overlap,
                bodyFont: getComputedStyle(table.querySelector('td')).fontSize,
                headingFont: getComputedStyle(table.querySelector('th')).fontSize,
                primary: getComputedStyle(document.querySelector('.fleet-toolbar .btn-primary'))
                    .backgroundColor,
                minWidth: document.body.scrollWidth,
            };
        });
        expect(metrics).toMatchObject({
            header: 58,
            toolbar: size.width <= 1180 ? 90 : 50,
            button: 34,
            filter: 30,
            count: 34,
            countFont: '9px',
            countWeight: '650',
            filterFont: '9px',
            filterPadding: size.width <= 1500 ? '0px 7px' : '0px 8px',
            filterColor: 'rgb(105, 115, 134)',
            primaryGap: '7px',
            toolbarGap: size.width <= 1500 ? '7px' : '10px',
            headingSpacing: '0.5px',
            heading: 36,
            row: 85,
            preview: 64,
            search: size.width < 1280 ? 0 : 32,
            overlap: false,
            bodyFont: '13px',
            headingFont: '11px',
            primary: 'rgb(70, 88, 217)',
        });
        expect(metrics.minWidth).toBeGreaterThanOrEqual(1280);
        await expectDeviceCountCentered(page);
        await expect(page.locator('.phone-preview').first()).toHaveCSS(
            'background-color',
            'rgb(242, 243, 247)',
        );
        await expect(page.locator('.phone-placeholder-icon').first()).toBeVisible();
        await page.screenshot({ path: `test-results/fidelity-${size.width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1837, height: 905 });
    await page.getByRole('button', { name: '切换明暗主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await expect(page.locator('.phone-preview').first()).toHaveCSS(
        'background-color',
        'rgb(30, 39, 55)',
    );
    await page.screenshot({ path: 'test-results/fidelity-dark.png', fullPage: true });
    await expectDeviceCountCentered(page);
    await page.setViewportSize({ width: 800, height: 800 });
    await expectDeviceCountCentered(page);
    await page.getByRole('button', { name: '切换明暗主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
    const onlineFilter = page.getByRole('button', { name: '在线', exact: true });
    await onlineFilter.focus();
    await page.keyboard.press('Enter');
    await expect(onlineFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fleet-count strong')).toHaveText('0');
    await expect(page.locator('.fleet-device-row')).toHaveCount(0);
    await expectDeviceCountCentered(page);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.locator('.fleet-count strong')).toHaveText('4');
    await page.setViewportSize({ width: 1837, height: 905 });
    await page.locator('.fleet-toolbar').screenshot({
        path: 'test-results/device-count-centered-toolbar.png',
    });
    console.log(
        'FIDELITY PASS: header=58; toolbar=50/90 narrow; buttons=34; filters=30/9px; count=34/9px/centered; heading=36; row=85; preview=36x64; widths=1837,1440,1280,800; dark=pass; empty-count=0; keyboard=pass',
    );
});

test('header keeps brand, account and tools visible without internal overlap at narrow desktop widths', async ({
    page,
}) => {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    const account = page.getByRole('link', { name: '账号设置', exact: true });
    await expect(account.locator('.account-identity strong')).toHaveText('mtx');
    for (const width of [940, 800, 700, 640, 625, 600, 550]) {
        await page.setViewportSize({ width, height: 800 });
        const compactAccount = await account.evaluate((element) => {
            const name = element.querySelector('.account-identity strong');
            return {
                width: element.getBoundingClientRect().width,
                nameClientWidth: name.clientWidth,
                nameScrollWidth: name.scrollWidth,
                title: element.title,
            };
        });
        expect(compactAccount.width).toBeGreaterThanOrEqual(82);
        expect(compactAccount.width).toBeLessThanOrEqual(90);
        expect(compactAccount.nameScrollWidth).toBeLessThanOrEqual(compactAccount.nameClientWidth);
        expect(compactAccount.title).toContain('mtx');
    }
    const longUsername = 'fixture_header_account_123456789';
    expect(longUsername).toHaveLength(32);
    await page.route('**/api/auth/me', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.user = {
            ...body.user,
            username: longUsername,
            apkId: '999999999',
            validUntil: Date.parse('2099-10-12T00:00:00+08:00'),
        };
        await route.fulfill({ response, json: body });
    });
    await page.reload();
    await expect(page.locator('.account-validity')).toHaveText('到期 2099-10-11');
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByRole('button', { name: '切换明暗主题' }).click();
        for (const width of [
            1837, 1440, 1280, 1279, 1177, 942, 941, 940, 920, 910, 901, 900, 800, 700, 640, 625,
            600, 550,
        ]) {
            await page.setViewportSize({ width, height: 800 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const metrics = await page.evaluate(() => {
                const box = (element) => {
                    const rect = element.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, height: rect.height };
                };
                const selectors = [
                    '.console-brand',
                    '.header-search',
                    '.header-device-stats',
                    '.header-periods',
                    '.console-account',
                    '.console-theme',
                    '.console-help',
                    '.console-logout',
                ];
                const parts = selectors
                    .map((selector) => document.querySelector(selector))
                    .filter((element) => getComputedStyle(element).display !== 'none')
                    .map(box);
                const brandText = document.querySelector('.console-brand strong');
                return {
                    header: box(document.querySelector('.console-topbar')),
                    parts,
                    brandWhiteSpace: getComputedStyle(brandText).whiteSpace,
                    brandHeight: box(brandText).height,
                    search: getComputedStyle(document.querySelector('.header-search')).display,
                    periods: getComputedStyle(document.querySelector('.header-periods')).display,
                    avatar: getComputedStyle(document.querySelector('.account-avatar')).display,
                    accountSubtitle: getComputedStyle(
                        document.querySelector('.account-identity small'),
                    ).display,
                    accountValidity: getComputedStyle(
                        document.querySelector('.console-account .account-validity'),
                    ).display,
                    accountTitle: document.querySelector('.console-account').title,
                    accountBox: box(document.querySelector('.console-account')),
                    nameClientWidth: document.querySelector('.account-identity strong').clientWidth,
                    nameScrollWidth: document.querySelector('.account-identity strong').scrollWidth,
                    nameOverflow: getComputedStyle(
                        document.querySelector('.account-identity strong'),
                    ).textOverflow,
                    toolBoxes: ['.console-theme', '.console-help', '.console-logout'].map(
                        (selector) => box(document.querySelector(selector)),
                    ),
                    yesterday: getComputedStyle(document.querySelector('.header-period.yesterday'))
                        .display,
                    row: box(document.querySelector('.fleet-device-row')).height,
                    canvas: document.documentElement.scrollWidth,
                };
            });
            expect(metrics.header.height).toBe(58);
            expect(metrics.header.left).toBe(0);
            expect(metrics.header.right).toBeLessThanOrEqual(width + 1);
            expect(metrics.brandWhiteSpace).toBe('nowrap');
            expect(metrics.brandHeight).toBeLessThan(25);
            for (let index = 1; index < metrics.parts.length; index++) {
                expect(metrics.parts[index].left).toBeGreaterThanOrEqual(
                    metrics.parts[index - 1].right - 1,
                );
            }
            expect(metrics.parts.at(-1).right).toBeLessThanOrEqual(width + 1);
            expect(metrics.search === 'none').toBe(width < 1280);
            expect(metrics.periods === 'none').toBe(width <= 940);
            if (width > 940) expect(metrics.yesterday === 'none').toBe(width < 1280);
            expect(metrics.avatar).not.toBe('none');
            expect(metrics.accountSubtitle === 'none').toBe(width <= 940);
            expect(metrics.accountValidity === 'none').toBe(width <= 940);
            expect(metrics.accountTitle).toContain(longUsername);
            expect(metrics.accountTitle).toContain('APK 999999999');
            expect(metrics.accountTitle).toContain('2099-10-11');
            expect(metrics.nameOverflow).toBe('ellipsis');
            if (width <= 940) {
                expect(metrics.accountBox.right - metrics.accountBox.left).toBeLessThanOrEqual(140);
                expect(metrics.nameClientWidth).toBeGreaterThan(0);
                expect(metrics.nameScrollWidth).toBeGreaterThan(metrics.nameClientWidth);
            }
            for (const tool of metrics.toolBoxes) {
                expect(tool.right - tool.left).toBe(34);
                expect(tool.height).toBe(34);
            }
            expect(metrics.row).toBe(85);
            expect(metrics.canvas).toBeGreaterThanOrEqual(1280);
            if ([1280, 800, 625, 550].includes(width)) {
                await page.locator('.console-topbar').screenshot({
                    path: `test-results/header-adaptation-${theme}-${width}.png`,
                });
            }
        }
    }
    await page.evaluate(() => window.scrollTo(180, 0));
    await expect
        .poll(() => page.locator('.console-topbar').evaluate((e) => e.getBoundingClientRect().left))
        .toBe(0);
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/settings/account');
    console.log(
        'HEADER_ADAPT PASS: widths=1837,1440,1280,1279,1177,942,941,940,920,910,901,900,800,700,640,625,600,550; light/dark; compact<=940; short-account=82-90; long-account<=140/32chars/ellipsis; tools=3x34; brand=single-line; overlap=0; account/tools=visible; row=85; canvas>=1280; sticky-left=0; keyboard=pass',
    );
});
