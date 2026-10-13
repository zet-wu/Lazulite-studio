import { importLyrics } from '../../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { timedIntervalsTtml } from '../../fixtures/timed-intervals';

test('native media crosses intervals, pauses, seeks and keeps playing through collapse', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5175/projects/media-offset/edit');
  await importLyrics(page, { name: 'playback-background.ttml', mimeType: 'application/xml', buffer: Buffer.from(timedIntervalsTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  const audio = page.locator('audio');
  const ordinary = page.getByRole('button', { name: '时间轴行 L1', exact: true });
  const overlapping = page.getByRole('button', { name: '时间轴行 L3', exact: true });
  const shadow = (bar: typeof ordinary) => bar.evaluate(e => getComputedStyle(e, '::after').boxShadow);
  await audio.evaluate((e: HTMLAudioElement) => { e.currentTime = 1.5; });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => !e.paused && e.currentTime >= 2.1)).toBe(true);
  await expect.poll(() => shadow(ordinary)).not.toBe('none');
  await expect.poll(() => shadow(overlapping)).not.toBe('none');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => shadow(ordinary)).not.toBe('none');
  await audio.evaluate((e: HTMLAudioElement) => { e.currentTime = 3.1; });
  await expect.poll(() => shadow(ordinary)).toBe('none');
  await expect.poll(() => shadow(overlapping)).not.toBe('none');

  await page.getByRole('button', { name: '循环当前行' }).click();
  const a = await page.getByRole('slider', { name: '循环 A 边界' }).getAttribute('aria-valuenow');
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  await expect(page.locator('[data-spectrum-ready]')).toBeVisible();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '收起时间轴' }).click();
  await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => e.paused)).toBe(false);
  await expect(page.locator('[data-spectrum-ready]')).toHaveCount(0);
  await page.getByRole('button', { name: '展开时间轴' }).click();
  await expect(page.getByRole('slider', { name: '循环 A 边界' })).toHaveAttribute('aria-valuenow', a!);
  await expect(page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-spectrum-ready]')).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await context.close();
});

test('saved independent background remains visible after its parent ends', async ({ page }) => {
  const url = '/api/v1/projects/background-playback/document';
  const envelope = await (await page.request.get(url)).json();
  await page.goto('/projects/background-playback/edit');
  const { backgroundTtml } = await import('../../fixtures/timed-intervals');
  envelope.document = await page.evaluate(async xml => {
    const codecPath = '/src/adapters/ttml/lyric-codec.ts';
    const projectPath = '/src/domain/project-document.ts';
    const { parseLyricTtml, serializeLyricTtml } = await import(codecPath);
    const { createProjectDocument } = await import(projectPath);
    const lyrics = parseLyricTtml(xml);
    lyrics.lines[1].backgroundOf = lyrics.lines[0].id;
    const project = createProjectDocument(lyrics);
    return { ...project, lyrics: { draftTtml: serializeLyricTtml(lyrics, { draft: true }) } };
  }, backgroundTtml());
  const response = await page.request.put(url, { headers: { origin: 'http://127.0.0.1:5175', 'if-match': envelope.revision }, data: envelope });
  expect(response.ok()).toBe(true);
  await page.goto('/projects/background-playback/edit');
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 3; });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const background = page.locator('.amll-lyric-player [class*="bgWrapper"]').filter({ hasText: '背景测试' });
  await expect.poll(() => background.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  await expect(background).toBeInViewport();

  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 4.2; e.playbackRate = .5; });
  await expect(background).toHaveClass(/bgWrapperActive/);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
});
