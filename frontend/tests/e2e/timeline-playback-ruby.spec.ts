import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { timedIntervalsTtml } from '../fixtures/timed-intervals';

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
