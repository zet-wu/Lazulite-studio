import { expect, test, type Page } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';
import { importLyrics } from '../fixtures/import-lyrics';
import { continuousBoundariesTtml } from '../fixtures/continuous-boundaries';

async function load(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadTimeline(page);
  await importLyrics(page, { name: 'continuous.ttml', mimeType: 'application/xml', buffer: Buffer.from(continuousBoundariesTtml) });
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('checkbox', { name: '吸附', exact: true }).uncheck();
}
for (const swapped of [false, true]) test(`boundary drag toggles adjacency during capture, swaps setting and undoes atomically: ${swapped}`, async ({ page }) => {
  await load(page);
  if (swapped) {
    await page.locator('[data-settings-button]').click();
    await page.getByRole('dialog').getByRole('button', { name: '时间轴', exact: true }).click();
    await page.getByRole('switch', { name: '交换边界拖动操作', exact: true }).check();
    await page.keyboard.press('Escape');
  }
  const a = page.getByRole('button', { name: '时间轴词 甲', exact: true });
  const b = page.getByRole('button', { name: '时间轴词 乙', exact: true });
  const edge = a.getByLabel('时间轴词 甲结束边界', { exact: true });
  const original = (await b.boundingBox())!.x;
  const handle = (await edge.boundingBox())!;
  // The ruby handle permits both previews; its parent follows the leaf envelope.
  const rubyEdge = page.getByLabel('时间轴注音 こう结束边界', { exact: true });
  await rubyEdge.scrollIntoViewIfNeeded();
  const r = (await rubyEdge.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  if (!swapped) await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 16, r.y + r.height / 2, { steps: 4 });
  await expect.poll(async () => (await b.boundingBox())!.x).toBeGreaterThan(original + 10);
  if (swapped) await page.keyboard.down('Control'); else await page.keyboard.up('Control');
  await expect.poll(async () => (await b.boundingBox())!.x).toBeCloseTo(original, 0);
  if (swapped) await page.keyboard.up('Control'); else await page.keyboard.down('Control');
  await expect.poll(async () => (await b.boundingBox())!.x).toBeGreaterThan(original + 10);
  await page.mouse.up(); await page.keyboard.up('Control');
  const after = (await b.boundingBox())!.x;
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await b.boundingBox())!.x).toBeCloseTo(original, 0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await b.boundingBox())!.x).toBeCloseTo(after, 0);
  // Word track handles carry the coincident tail/head ruby endpoints too.
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  if (!swapped) await page.keyboard.down('Meta');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 18, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up(); await page.keyboard.up('Meta');
  await expect.poll(async () => (await b.boundingBox())!.x).toBeGreaterThan(original + 10);
  await page.locator('[data-settings-button]').click();
  await page.getByRole('dialog').getByRole('button', { name: '时间轴', exact: true }).click();
  await expect(page.getByRole('switch', { name: '交换边界拖动操作', exact: true })).toBeChecked({ checked: swapped });
});

test('linked boundary leaves its original snap point and Escape cancels the candidate', async ({ page }) => {
  await load(page);
  // Keep independent romanization/beat anchors away from the moved boundary.
  await importLyrics(page, { name: 'snap.ttml', mimeType: 'application/xml', buffer: Buffer.from(continuousBoundariesTtml.replace(/<head>.*<\/head>/, '').replaceAll('="2"', '="2.13"')) });
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('checkbox', { name: '吸附', exact: true }).check();
  const b = page.getByRole('button', { name: '时间轴词 乙', exact: true });
  const original = (await b.boundingBox())!.x;
  const edge = page.getByLabel('时间轴词 甲结束边界', { exact: true });
  const r = (await edge.boundingBox())!;
  await page.keyboard.down('Control');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 5, r.y + r.height / 2, { steps: 3 });
  await expect.poll(async () => (await b.boundingBox())!.x).toBeGreaterThan(original + 2);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Control');
  await expect.poll(async () => (await b.boundingBox())!.x).toBeCloseTo(original, 0);
});

test('frame playback advances word, ruby and timed romanization highlights within one followed line', async ({ page }) => {
  await load(page);
  await page.getByRole('checkbox', { name: '播放跟随', exact: true }).check();
  const a = page.getByRole('button', { name: '时间轴词 甲', exact: true });
  const b = page.getByRole('button', { name: '时间轴词 乙', exact: true });
  const rubyB = page.getByRole('button', { name: '时间轴注音 おつ', exact: true });
  const romanB = page.locator('[data-timeline-key][data-romanization-unit-id]').filter({ hasText: /^b$/ });
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    let position = 1.2;
    Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => position, set: value => { position = value; } });
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
    audio.dispatchEvent(new Event('seeked')); audio.dispatchEvent(new Event('play'));
  });
  await expect(a).toHaveAttribute('aria-current', 'time');
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 2.2; });
  await expect(b).toHaveAttribute('aria-current', 'time');
  await expect(rubyB).toHaveAttribute('aria-current', 'time');
  await expect(romanB).toHaveAttribute('aria-current', 'time');
  await expect(a).not.toHaveAttribute('aria-current');
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 3.2; audio.dispatchEvent(new Event('pause')); });
  await expect(b).not.toHaveAttribute('aria-current');
  await expect(page.getByRole('button', { name: '时间轴词 丙', exact: true })).toHaveAttribute('aria-current', 'time');
});
