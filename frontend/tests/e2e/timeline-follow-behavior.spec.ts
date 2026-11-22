import { expect, test } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';
import { importLyrics } from '../fixtures/import-lyrics';

test('playback follow advances viewport smoothly and keeps drag coordinates valid without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadTimeline(page, true);
  await importLyrics(page, {
    name: 'follow.ttml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="l1" begin="6" end="12"><span begin="6" end="12">歌</span></p></body></tt>',
    ),
  });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('checkbox', { name: '播放跟随', exact: true }).check();
  await page.getByRole('checkbox', { name: '吸附', exact: true }).uncheck();

  // Start playback and advance smoothly while viewport follows.
  await page.evaluate(() => {
    const el = document.querySelector('audio')!;
    let current = 4;
    let paused = false;
    Object.defineProperty(el, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    el.pause = () => { paused = true; el.dispatchEvent(new Event('pause')); };
    el.play = async () => { paused = false; el.dispatchEvent(new Event('play')); };
    void el.play();
    const step = () => {
      if (paused) return;
      current += 0.04;
      if (current < 9) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  const plots = page.locator('#timeline-plots');
  const startBefore = Number(await plots.getAttribute('data-view-start'));
  await expect.poll(async () => Number(await plots.getAttribute('data-view-start'))).toBeGreaterThan(startBefore + 1000);

  // Drag the visible line bar while playback follow is active and verify its committed time moves forward.
  const bar = page.getByRole('button', { name: '时间轴行 L1', exact: true });
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const beginInput = page.getByLabel('行 1开始秒数');
  const beginBefore = Number(await beginInput.inputValue());
  const dragBox = (await bar.boundingBox())!;
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 40, dragBox.y + dragBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await beginInput.inputValue())).toBeGreaterThan(beginBefore);

  await page.evaluate(() => document.querySelector('audio')?.pause());
  expect(errors).toEqual([]);
});
