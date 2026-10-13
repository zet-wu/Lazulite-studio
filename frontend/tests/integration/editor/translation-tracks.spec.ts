import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../../fixtures/import-lyrics';

test('document translation tracks survive actual save, reopen, reorder, partial transfer and final consumer parsing', async ({ page }) => {
  await page.goto('/projects/background-playback/edit');
  const xml = await page.evaluate(async () => {
    const path = '/src/domain/lyric-document.ts', codecPath = '/src/adapters/ttml/lyric-codec.ts';
    const { createLyricDocument, createLine, plainTranslation } = await import(path) as typeof import('../../../src/domain/lyric-document');
    const { serializeLyricTtml } = await import(codecPath) as typeof import('../../../src/adapters/ttml/lyric-codec');
    const d = createLyricDocument(); d.lines = ['a', 'a-bg', 'b'].map((id, i) => ({ ...createLine(`正文${i}`, id), beginMs: 1000 + i * 2000, endMs: 3000 + i * 2000, backgroundOf: i === 1 ? 'a' : null }));
    d.translationTracks = [
      { id: 'one', language: 'en', purpose: 'subtitle', contents: [plainTranslation(' one ', 'a'), plainTranslation('two', 'b')] },
      { id: 'two', language: 'en', purpose: 'replacement', contents: [{ id: 'timed', lineId: 'a', kind: 'timed', units: [{ id: 'u', text: ' timed ', beginMs: 1000, endMs: 2000 }] }, plainTranslation(' bg ', 'a-bg')] },
      { id: 'empty', language: null, purpose: 'subtitle', contents: [] },
    ];
    return serializeLyricTtml(d, { draft: true });
  });
  await importLyrics(page, { name: 'tracks.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-top-menu=lyrics-settings] summary').click();
  await page.getByRole('button', { name: '管理翻译轨道…', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '翻译轨道管理' });
  await manager.getByRole('button', { name: '下移翻译轨道 1', exact: true }).click();
  await manager.getByRole('checkbox', { name: /^选择翻译轨道 / }).nth(2).check();
  await manager.getByLabel('翻译归轨目标').selectOption('two');
  await manager.getByRole('button', { name: '转入目标轨道', exact: true }).click();
  await manager.getByRole('button', { name: '应用', exact: true }).click();
  const put = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/background-playback/document') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click(); expect((await put).status()).toBe(200);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
  await page.reload(); await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const final = await readFile(await (await download).path(), 'utf8');
  const evidence = await page.evaluate(async ({ draft, final }) => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const { parseLyricTtml } = await import(path) as typeof import('../../../src/adapters/ttml/lyric-codec');
    const d = parseLyricTtml(draft), f = parseLyricTtml(final);
    const semantics = (doc: typeof d) => doc.translationTracks.map(({ id, contents, ...track }) => ({ ...track, contents: contents.map(({ id, ...content }) => content.kind === 'plain' ? content : { ...content, units: content.units.map(({ id, ...unit }) => unit) }) }));
    return { trackIds: d.translationTracks.map(track => track.id), draft: semantics(d), final: semantics(f), unitId: d.translationTracks[0].contents[0].kind === 'timed' ? d.translationTracks[0].contents[0].units[0].id : null };
  }, { draft: saved.document.lyrics.draftTtml, final });
  expect(evidence.trackIds).toEqual(['two', 'one', 'empty']); expect(evidence.unitId).toBe('u');
  expect(evidence.draft[0].contents).toHaveLength(3); expect(evidence.draft.at(-1)!.contents).toEqual([]);
  expect(evidence.final).toEqual(evidence.draft); expect(final).not.toContain('studio:');
  await writeFile(test.info().outputPath('translation-tracks-roundtrip.json'), JSON.stringify(evidence, null, 2));
});
