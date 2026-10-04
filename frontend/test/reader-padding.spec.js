import { test, expect } from '@playwright/test';

test('reader short label keeps original 14x18 geometry and fits cs without extra padding', async ({
    page,
}) => {
    await page.goto('/login');
    await page.evaluate(() => {
        const node = document.createElement('div');
        node.className = 'reader-map-node';
        node.id = 'synthetic-reader-padding';
        node.style.cssText = 'left:100px;top:100px;width:14px;height:18px;font-size:8.8px';
        const label = document.createElement('span');
        label.textContent = 'cs';
        node.append(label);
        document.body.append(node);
    });
    const node = page.locator('#synthetic-reader-padding');
    await expect(node).toHaveCSS('padding', '0px');
    const metrics = await node.evaluate((element) => {
        const label = element.querySelector('span');
        const range = document.createRange();
        range.selectNodeContents(label);
        const rects = [...range.getClientRects()];
        const box = element.getBoundingClientRect();
        return {
            width: box.width,
            height: box.height,
            lines: new Set(rects.map((rect) => rect.top)).size,
            textHeight: label.getBoundingClientRect().height,
        };
    });
    expect(metrics.width).toBe(14);
    expect(metrics.height).toBe(18);
    expect(metrics.lines).toBe(1);
    expect(metrics.textHeight).toBeLessThan(18);
    console.log(
        'READER PADDING PASS: padding=0px; cs=1 line; bounds=14x18 unchanged (synthetic fixture)',
    );
});
