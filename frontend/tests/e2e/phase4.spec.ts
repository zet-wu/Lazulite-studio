import { expect, test } from '@playwright/test';
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
    expect((await page.locator('footer').boundingBox())!.height).toBeLessThan(60);
    expect(Math.abs((await clock.boundingBox())!.x - x)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('collapsed.png') });
    await collapsed.press('Enter');
    await expect(toggle).toBeFocused();
    await toggle.press('Space');
    await expect(collapsed).toBeFocused();
    await collapsed.press('Space');
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('expanded.png') });
  });
}

test('P4-02 playing color is visible on ordinary and true narrow widths', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'phase4.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase4Ttml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  const audio = page.locator('audio');
  await audio.evaluate((e: HTMLAudioElement) => { e.currentTime = 2; e.dispatchEvent(new Event('seeked')); });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const index of [0, 1]) {
      await page.locator('[data-outline-drag]').nth(index).click();
      for (const kind of ['行', '词', 'Ruby']) {
        const bar = page.getByRole('button', { name: new RegExp(`^时间轴${kind} `) }).nth(kind === '行' ? index : 0);
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
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(rubyTtml()) });
  const line = page.locator('main section[data-line-id="kana"]');
  await expect(line.locator('[data-romanization-content-id]')).toBeVisible();
  const source = await line.locator('[data-romanization-content-id] input').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
  await line.getByText('音译 · ja-Latn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 Ruby…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 Ruby' });
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
  await dialog.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(2);
  await expect(line.getByRole('textbox', { name: '读音 か', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(line.getByRole('textbox', { name: '读音 がな', exact: true })).toHaveCount(2);
  expect(await line.locator('[data-romanization-content-id] input').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value))).toEqual(source);
});
