import { importLyrics } from '../fixtures/import-lyrics';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/phase3';
import { phase4Ttml, rubyTtml } from '../fixtures/phase4';

for (const theme of ['light', 'dark']) for (const width of [1280, 1440, 1920]) {
  test(`P4-01 compact persistent toggle ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/projects/sample-project/edit');
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const toggle = page.getByRole('button', { name: '收起时间轴', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.evaluate(e => e.setAttribute('data-persistent-toggle', 'yes'));
    const clock = page.locator('footer').locator('span').first();
    const x = (await clock.boundingBox())!.x;
    await toggle.click();
    const collapsed = page.getByRole('button', { name: '展开时间轴', exact: true });
    await expect(collapsed).toBeFocused();
    await expect(collapsed).toHaveAttribute('data-persistent-toggle', 'yes');
    await expect(collapsed).toHaveAttribute('aria-expanded', 'false');
    const collapsedHeight = (await page.locator('footer').boundingBox())!.height;
    expect(collapsedHeight).toBeLessThan(60);
    await expect(collapsed.locator('svg path')).toHaveAttribute('d', 'M1 7h10L6 1z');
    expect(Math.abs((await clock.boundingBox())!.x - x)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('collapsed.png') });
    await collapsed.press('Enter');
    await expect(toggle).toBeFocused();
    await toggle.press('Space');
    await expect(collapsed).toBeFocused();
    await collapsed.press('Space');
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(toggle.locator('svg path')).toHaveAttribute('d', 'M1 1h10L6 7z');
    await writeFile(test.info().outputPath('geometry.json'), JSON.stringify({ width, height: 900, theme, dpr: 1, collapsedHeight, expandedHeight: (await page.locator('footer').boundingBox())!.height, clockX: x }, null, 2));
    await page.screenshot({ path: test.info().outputPath('expanded.png') });
  });
}

test('P4-02 playing color is visible on ordinary and true narrow widths', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'phase4.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase4Ttml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  const audio = page.locator('audio');
  await audio.evaluate((e: HTMLAudioElement) => { e.currentTime = 2; e.dispatchEvent(new Event('seeked')); });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const index of [0, 1]) {
      await page.locator('[data-outline-drag]').nth(index).click();
      for (const kind of ['行', '词', '注音']) {
        const bar = page.getByRole('button', { name: new RegExp(`^时间轴${kind} `) }).nth(kind === '行' ? index : 0);
        await bar.focus();
        const color = index === 1 ? bar.locator('[data-time-color]') : bar;
        await expect.poll(() => color.evaluate(e => getComputedStyle(e, e.hasAttribute('data-time-color') ? null : '::after').boxShadow)).toContain('240, 164, 43');
        if (index === 1) expect((await color.boundingBox())!.width).toBeLessThan(1);
      }
    }
    await page.screenshot({ path: test.info().outputPath(`playing-${theme}.png`) });
  }
});

test('P4-04/05 grouped skips, manual generation, history and checkpoint with bounded layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(rubyTtml()) });
  const line = page.locator('main section[data-line-id="kana"]');
  await expect(line.locator('[data-romanization-content-id]')).toBeVisible();
  const source = await line.locator('[data-romanization-content-id] input').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
  await line.getByText('音译 · ja-Latn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  const skips = dialog.getByLabel('跳过生成');
  await expect(skips).toHaveCount(3);
  for (const skip of await skips.all()) {
    await expect(skip).toBeChecked();
    expect(await skip.locator('..').evaluate(e => getComputedStyle(e).whiteSpace)).toBe('nowrap');
  }
  expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('status')).toContainText('所有单元均跳过');
  await page.screenshot({ path: test.info().outputPath('ruby-default-skips.png') });
  await skips.nth(0).uncheck(); await skips.nth(1).uncheck();
  await dialog.getByRole('button', { name: '生成 注音', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(2);
  await expect(line.getByRole('textbox', { name: '读音 か', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(2);
  expect(await line.locator('[data-romanization-content-id] input').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value))).toEqual(source);
});

test('P4-06 wheel zoom keeps clipped edges uneditable and pointercancel leaves no transaction', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'phase4.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase4Ttml()) });
  await page.locator('[data-outline-drag]').first().click();
  const bar = page.getByRole('button', { name: '时间轴行 L1', exact: true });
  await expect(bar).toBeVisible();
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 2; e.dispatchEvent(new Event('seeked')); });
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await expect(bar.getByLabel('时间轴行 L1开始边界')).toHaveCount(0);
  await expect(bar.getByLabel('时间轴行 L1结束边界')).toBeVisible();
  const wave = page.getByRole('slider', { name: '波形进度' });
  const width = (await bar.boundingBox())!.width;
  await wave.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await bar.boundingBox())!.width).toBeGreaterThan(width);
  const begin = page.getByRole('textbox', { name: '行 ordinary开始秒数', exact: true });
  const before = await begin.inputValue();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
  await bar.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(begin).toHaveValue(before);
});

test('P4-08 large proposal scroll preserves manual choices while mounting only visible rows', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const xml = performanceTtml(2000).replace(/<text for="p(\d+)"><span begin="[^"]*" end="[^"]*">rom<\/span><\/text>/g, (_, i) =>
    `<text for="p${i}"><span begin="${(Number(i) * .3).toFixed(3)}" end="${(Number(i) * .3 + .024).toFixed(3)}">ko</span></text>`);
  await importLyrics(page, { name: 'large-ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2000);
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('[data-top-menu="clipboard"] summary').click(); await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.locator('[data-top-menu="tools"] summary').click(); await page.getByRole('button', { name: '从音译生成 注音…', exact: true }).click();
  const dialog = page.locator('[role=dialog]');
  const rows = dialog.locator('[data-proposal-count]');
  await expect(rows).toHaveAttribute('data-proposal-count', '2000');
  expect(await dialog.getByLabel('目标词').count()).toBeLessThan(80);
  const first = rows.locator('[data-index="0"]');
  await first.getByLabel('跳过生成').check();
  await rows.evaluate(e => { e.scrollTop = e.scrollHeight; });
  const last = rows.locator('[data-index="1999"]');
  await expect.poll(async () => {
    await rows.evaluate(e => { e.scrollTop = e.scrollHeight; });
    return last.isVisible();
  }, { timeout: 20_000 }).toBe(true);
  await last.getByLabel('目标 注音').fill('手动末行');
  await rows.evaluate(e => { e.scrollTop = 0; });
  await expect(first.getByLabel('跳过生成')).toBeChecked();
  await rows.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect.poll(async () => {
    await rows.evaluate(e => { e.scrollTop = e.scrollHeight; });
    return last.isVisible();
  }, { timeout: 20_000 }).toBe(true);
  await expect(last.getByLabel('目标 注音')).toHaveValue('手动末行');
  expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('large-ruby-visible-rows.png') });
});
