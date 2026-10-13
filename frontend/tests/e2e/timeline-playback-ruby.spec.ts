import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/large-document';
import { rubyTtml, timedIntervalsTtml } from '../fixtures/timed-intervals';

  test('collapse toggle retains keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projects/sample-project/edit');

    const toggle = page.getByRole('button', { name: '收起时间轴', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.evaluate(e => e.setAttribute('data-persistent-toggle', 'yes'));
    await toggle.click();
    const collapsed = page.getByRole('button', { name: '展开时间轴', exact: true });
    await expect(collapsed).toBeFocused();
    await expect(collapsed).toHaveAttribute('data-persistent-toggle', 'yes');
    await expect(collapsed).toHaveAttribute('aria-expanded', 'false');
    await collapsed.press('Enter');
    await expect(toggle).toBeFocused();
    await toggle.press('Space');
    await expect(collapsed).toBeFocused();
    await collapsed.press('Space');
    await expect(toggle).toBeFocused();
  });

test('grouped skips, manual generation, history and checkpoint with bounded layout', async ({ page }) => {
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

  }

  await expect(dialog.getByRole('status')).toContainText('所有单元均跳过');

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

test('wheel zoom keeps clipped edges uneditable and pointercancel leaves no transaction', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'timeline-playback-ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(timedIntervalsTtml()) });
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
  const begin = page.getByRole('textbox', { name: '行 1开始秒数', exact: true });
  const before = await begin.inputValue();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
  await bar.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(begin).toHaveValue(before);
});

test('large proposal scroll preserves manual choices while mounting only visible rows', async ({ page }) => {
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
});
