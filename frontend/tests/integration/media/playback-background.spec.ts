import { importLyrics } from '../../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { timedIntervalsTtml } from '../../fixtures/timed-intervals';

test('native media crosses intervals, pauses, seeks and keeps playing through collapse', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: test.info().outputPath('media-video') } });
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
  await expect.poll(() => shadow(ordinary)).toContain('240, 164, 43');
  await expect.poll(() => shadow(overlapping)).toContain('240, 164, 43');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => shadow(ordinary)).toContain('240, 164, 43');
  await audio.evaluate((e: HTMLAudioElement) => { e.currentTime = 3.1; });
  await expect.poll(() => shadow(ordinary)).toBe('none');
  await expect.poll(() => shadow(overlapping)).toContain('240, 164, 43');
  await page.screenshot({ path: test.info().outputPath('native-paused-seek.png') });
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
  await page.video()!.saveAs(test.info().outputPath('native-media.webm'));
});

test('independent background saves, exchanges and is visible after its parent ends', async ({ page }) => {
  const { backgroundTtml } = await import('../../fixtures/timed-intervals');
  await page.goto('/projects/background-playback/edit');
  await importLyrics(page, { name: 'background.ttml', mimeType: 'application/xml', buffer: Buffer.from(backgroundTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
  await page.locator('[data-outline-drag]').nth(1).click();
  await page.getByLabel('背景歌词', { exact: true }).check();
  await expect(page.getByLabel('所属主行')).toHaveValue('parent');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
  expect(saved.document.lyrics.draftTtml).toContain('dur="00:05.000"');
  await page.reload();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('所属主行')).toHaveValue('parent');
  await expect(page.getByRole('textbox', { name: '行 background结束秒数', exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 3; });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const background = page.locator('.amll-lyric-player [class*="bgWrapper"]').filter({ hasText: '背景测试' });
  await expect.poll(() => background.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  await expect(background).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('background-after-parent.png') });
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 4.2; e.playbackRate = .5; });
  await expect(background).toHaveClass(/bgWrapperActive/);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载歌词' }).click();
  const path = (await (await download).path())!;
  await importLyrics(page, { name: 'reopened.ttml', mimeType: 'application/ttml+xml', buffer: await (await import('node:fs/promises')).readFile(path) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('背景歌词', { exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: /行 .*结束秒数/ })).toHaveValue('5');
});

test('readonly original L2/L3 survives real save, final reopen and AMLL long background display', async ({ browser }) => {
  test.skip(!process.env.STUDIO_REVIEW_TTML, 'Provide the original review TTML explicitly; never copy it into fixtures.');
  const { readFile, writeFile } = await import('node:fs/promises');
  const raw = await readFile(process.env.STUDIO_REVIEW_TTML!, 'utf8');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: test.info().outputPath('review-video') } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5175/projects/background-playback/edit');
  const prepared = await page.evaluate(async raw => {
    const codecPath = '/src/adapters/ttml/lyric-codec.ts', commandPath = '/src/domain/lyric-commands.ts';
    const codec = await import(codecPath) as typeof import('../../../src/adapters/ttml/lyric-codec');
    const commands = await import(commandPath) as typeof import('../../../src/domain/lyric-commands');
    const document = codec.parseLyricTtml(raw), parent = document.lines[1], background = document.lines[2];
    let state = commands.createLyricEditorState(document);
    for (const track of document.romanizationTracks) for (const content of track.contents.filter(c => c.lineId === background.id)) {
      state = commands.executeLyricCommand(state, { type: 'delete-romanization-content', trackId: track.id, contentId: content.id });
    }
    state = commands.executeLyricCommand(state, { type: 'set-translation-tracks', source: state.present.translationTracks, tracks: state.present.translationTracks.map(track => ({ ...track, contents: track.contents.filter(content => content.lineId !== background.id) })) });
    state = commands.executeLyricCommand(state, { type: 'set-background-of', lineId: background.id, parentLineId: parent.id });
    return { xml: codec.serializeLyricTtml(state.present, { draft: true }), parentId: parent.id, backgroundId: background.id,
      parentTime: [parent.beginMs, parent.endMs], backgroundTime: [background.beginMs, background.endMs],
      words: background.words.map(w => [w.text, w.beginMs, w.endMs]), lineCount: document.lines.length };
  }, raw);
  expect(prepared.parentTime).toEqual([6426, 8155]);
  expect(prepared.backgroundTime).toEqual([8155, 129984]);
  await importLyrics(page, { name: 'review-working-copy.ttml', mimeType: 'application/xml', buffer: Buffer.from(prepared.xml) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(prepared.lineCount);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('[data-outline-drag]').nth(2).click();
  await expect(page.getByLabel('所属主行')).toHaveValue(prepared.parentId);
  await expect(page.getByRole('textbox', { name: `行 ${prepared.backgroundId}结束秒数`, exact: true })).toHaveValue('129.984');
  const saved = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  const bg = page.locator('.amll-lyric-player [class*="bgWrapper"]');
  for (const time of [8.5, 10, 11, 65, 129]) {
    await page.locator('audio').evaluate((e: HTMLAudioElement, time) => { e.currentTime = time; e.playbackRate = .5; }, time);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(bg).toHaveClass(/bgWrapperActive/);
    await expect.poll(() => bg.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
    await expect(bg).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`review-background-${time}.png`) });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
  }
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载歌词' }).click();
  const finalXml = await readFile((await (await download).path())!, 'utf8');
  for (const xml of [saved.document.lyrics.draftTtml, finalXml]) {
    const result = await page.evaluate(async xml => {
      const codecPath = '/src/adapters/ttml/lyric-codec.ts';
      const codec = await import(codecPath) as typeof import('../../../src/adapters/ttml/lyric-codec');
      const document = codec.parseLyricTtml(xml), parent = document.lines[1], bg = document.lines[2];
      return { parentTime: [parent.beginMs, parent.endMs], bgTime: [bg.beginMs, bg.endMs], bgParent: bg.backgroundOf, parentId: parent.id, bgId: bg.id, words: bg.words.map(w => [w.text, w.beginMs, w.endMs]) };
    }, xml);
    expect(result.parentTime).toEqual(prepared.parentTime);
    expect(result.bgTime).toEqual(prepared.backgroundTime);
    expect(result.bgParent).toBe(result.parentId);
    expect(result.words).toEqual(prepared.words);
    if (xml === saved.document.lyrics.draftTtml) expect(result.bgId).toBe(prepared.backgroundId);
  }
  await importLyrics(page, { name: 'review-final-reopen.ttml', mimeType: 'application/xml', buffer: Buffer.from(finalXml) });
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 65; });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(bg).toHaveClass(/bgWrapperActive/);
  await expect(bg).toBeInViewport();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(await readFile(process.env.STUDIO_REVIEW_TTML!, 'utf8')).toBe(raw);
  await writeFile(test.info().outputPath('review-times.json'), JSON.stringify({ parentTime: prepared.parentTime, backgroundTime: prepared.backgroundTime, wordCount: prepared.words.length, previewTimes: [8.5, 10, 11, 65, 129], nativeAudio: '132s synthetic', sourceUnchanged: true }, null, 2));
  await context.close();
  await page.video()!.saveAs(test.info().outputPath('review-background.webm'));
});
