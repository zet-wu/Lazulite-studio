import { expect, test } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';

test('filtering, warning and explicit overwrite apply atomically and survive real save/final exchange', async ({ page }) => {
  await page.goto('/projects/background-playback/edit');
  const xml = await page.evaluate(async () => {
    const domainPath = '/src/domain/lyric-document.ts', codecPath = '/src/adapters/ttml/lyric-codec.ts';
    const { createLyricDocument, createWord } = await import(domainPath), codec = await import(codecPath);
    const doc = createLyricDocument('は字'), line = doc.lines[0];
    Object.assign(line, { id: 'p11', beginMs: 1000, endMs: 3000 });
    line.words = [
      { ...createWord('は', 'ha'), beginMs: 1000, endMs: 2000, rubyUnits: [{ id: 'old', reading: 'は', beginMs: 1000, endMs: 2000 }] },
      { ...createWord('字', 'ji'), beginMs: 2000, endMs: 3000 },
    ];
    doc.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'punctuation', text: '，。…', beginMs: 0, endMs: 9999 },
      { id: 'wa', text: 'wa', beginMs: 999, endMs: 2000 },
      { id: 'ka', text: 'ka', beginMs: 2000, endMs: 3000 },
    ] }] }];
    return codec.serializeLyricTtml(doc, { draft: true });
  });
  await importLyrics(page, { name: 'p11.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '从音译生成注音', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成注音', exact: true });
  await expect(dialog.locator('[data-ruby-row]')).toHaveCount(2);
  await dialog.getByRole('checkbox', { name: /覆盖/ }).check();
  await dialog.getByLabel('目标 注音').last().fill('じ');
  await expect(dialog.getByRole('button', { name: /核对 · L1/ })).toHaveCount(1);
  await dialog.getByRole('button', { name: '生成 注音', exact: true }).click();
  const line = page.locator('main section[data-line-id="p11"]');
  await expect(line.getByLabel('读音 は', { exact: true })).toHaveValue('わ');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(line.getByLabel('读音 は', { exact: true })).toHaveValue('は');
  await expect(line.getByLabel('读音 字', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(line.getByLabel('读音 字', { exact: true })).toHaveValue('じ');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
  await page.reload(); await expect(line.getByLabel('读音 は', { exact: true })).toHaveValue('わ');
  const result = await page.evaluate(async ({ before, after }) => {
    const path = '/src/adapters/ttml/lyric-codec.ts', codec = await import(path);
    const original = codec.parseLyricTtml(before), draft = codec.parseLyricTtml(after);
    const reopened = codec.parseLyricTtml(codec.serializeLyricTtml(draft));
    return { sourceUnchanged: JSON.stringify(original.romanizationTracks) === JSON.stringify(draft.romanizationTracks),
      line: [draft.lines[0].beginMs, draft.lines[0].endMs],
      words: reopened.lines[0].words.map((word: any) => [word.text, word.beginMs, word.endMs, word.rubyUnits.map((unit: any) => [unit.reading, unit.beginMs, unit.endMs])]) };
  }, { before: xml, after: saved.document.lyrics.draftTtml });
  expect(result.sourceUnchanged).toBe(true); expect(result.line).toEqual([999, 3000]);
  expect(result.words).toEqual([['は', 999, 2000, [['わ', 999, 2000]]], ['字', 2000, 3000, [['じ', 2000, 3000]]]]);
});
