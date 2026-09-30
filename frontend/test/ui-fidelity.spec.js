import { test, expect } from '@playwright/test';

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
            search: 32,
            overlap: false,
            bodyFont: '13px',
            headingFont: '11px',
            primary: 'rgb(70, 88, 217)',
        });
        expect(metrics.minWidth).toBeGreaterThanOrEqual(1280);
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
    await page.getByRole('button', { name: '切换明暗主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
    console.log(
        'FIDELITY PASS: header=58; toolbar=50/90 narrow; buttons=34; filters=30/9px; count=34/9px; heading=36; row=85; preview=36x64; widths=1837,1440,1280,800; dark=pass',
    );
});
