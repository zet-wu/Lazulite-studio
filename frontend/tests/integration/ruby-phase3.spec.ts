import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';
import { backgroundPhase3 } from '../fixtures/background-phase3';

test('background sublyrics and independent singers survive service save/reopen and final export/reimport', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  await importLyrics(page, { name: 'background.ttml', mimeType: 'application/xml', buffer: Buffer.from(backgroundPhase3) });
  const bg = page.locator('main section[data-line-id="L1:bg"]');
  await bg.getByRole('textbox', { name: '翻译 1', exact: true }).fill(' 背景翻译  ');
  await bg.getByRole('textbox', { name: '翻译 1', exact: true }).press('Enter');
  await page.locator('[data-line-id="L1:bg"] > [data-outline-drag]').click();
  await page.getByRole('checkbox', { name: '歌手 Main', exact: true }).check();
  const response = page.waitForResponse(r => r.url().endsWith('/phase4-background/document') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click(); expect((await response).status()).toBe(200);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  const semantics = (xml: string) => page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const { parseLyricTtml } = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const d = parseLyricTtml(xml);
    return { lines: d.lines.map(l => ({ id: l.id, parent: l.backgroundOf, agents: l.agentRefs, translations: l.translations, text: l.words.map(w => w.text).join(''), beginMs: l.beginMs, endMs: l.endMs })),
      tracks: d.romanizationTracks.map(t => ({ language: t.language, contents: t.contents.map(c => c.kind === 'plain' ? { lineId: c.lineId, kind: c.kind, text: c.text } : { lineId: c.lineId, kind: c.kind, units: c.units.map(({ text, beginMs, endMs }) => ({ text, beginMs, endMs })) }) })) };
  }, xml);
  const before = await semantics(saved.document.lyrics.draftTtml);
  expect(before.lines[1]).toMatchObject({ text: 'かな', agents: ['v2', 'v1'], translations: [{ language: 'zh', text: ' 背景翻译  ' }] });
  expect(before.tracks[0].contents[1]).toMatchObject({ lineId: 'L1:bg', kind: 'timed', units: [{ text: 'ka ', beginMs: 2000, endMs: 3000 }, { text: 'na', beginMs: 3000, endMs: 4000 }] });
  await page.reload(); await expect(bg.getByRole('textbox', { name: '翻译 1', exact: true })).toHaveValue(' 背景翻译  ');
  await page.locator('[data-line-id="L1:bg"] > [data-outline-drag]').click();
  for (const name of ['Main', 'Backing']) await expect(page.getByRole('checkbox', { name: `歌手 ${name}`, exact: true })).toBeChecked();
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const finalXml = await readFile(await (await download).path(), 'utf8');
  expect(await semantics(finalXml)).toEqual(before);
  expect(finalXml).not.toContain('studio:'); expect(finalXml).not.toContain('x-roman');
  await importLyrics(page, { name: 'reimport.ttml', mimeType: 'application/xml', buffer: Buffer.from(finalXml) });
  await expect(bg.getByRole('textbox', { name: '翻译 1', exact: true })).toHaveValue(' 背景翻译  ');
  await expect(bg.locator('[data-romanization-unit-id]')).toHaveCount(2);
  await writeFile(test.info().outputPath('background-roundtrip.json'), JSON.stringify(before, null, 2));
  await writeFile(test.info().outputPath('background-final.ttml'), finalXml);
});
