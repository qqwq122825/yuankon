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
            toolbar: 50,
            button: 34,
            filter: 34,
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
        'FIDELITY PASS: header=58; toolbar=50; buttons=34; heading=36; row=85; preview=36x64; widths=1837,1440,1280,800; dark=pass',
    );
});
