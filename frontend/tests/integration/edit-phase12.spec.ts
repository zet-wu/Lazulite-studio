import { expect, test } from '@playwright/test';
import { importPhase12 } from '../fixtures/phase12';

test('P12 merges, splits, drafts and atomic history survive real save, reopen and TTML exchange', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  const original = await importPhase12(page);
  const line = page.locator('main section[data-line-id="p12-0"]');
  const words = line.locator('[data-word-id]');
  await words.first().click({ position: { x: 3, y: 3 } });
  await words.nth(1).click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await words.first().click({ position: { x: 3, y: 3 }, button: 'right' });
  await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(line.getByLabel('词 今日', { exact: true })).toBeFocused();
  const ruby = line.locator('[data-ruby-id]');
  await ruby.first().click({ position: { x: 3, y: 3 } }); await ruby.last().click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await ruby.first().click({ position: { x: 3, y: 3 }, button: 'right' }); await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(line.getByLabel('读音 今日', { exact: true })).toHaveValue('きょう');
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await dialog.getByRole('button', { name: '在第 3 词前切分' }).click(); await dialog.getByRole('button', { name: '在第 2 词前切分' }).click();
  await dialog.getByLabel('翻译 1归属').selectOption({ label: '第 2 行' });
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  await page.reload(); await expect(line.getByLabel('读音 今日', { exact: true })).toHaveValue('きょう');
  const results = await page.evaluate(async ({ original, xml }) => {
    const path = '/src/adapters/ttml/lyric-codec.ts', codec = await import(path);
    const before = codec.parseLyricTtml(original), draft = codec.parseLyricTtml(xml), final = codec.parseLyricTtml(codec.serializeLyricTtml(draft));
    const shape = (doc: any) => ({ words: doc.lines.filter((line: any) => !line.backgroundOf).map((line: any) => line.words.map((word: any) => [word.text, word.beginMs, word.endMs, word.rubyUnits.map((unit: any) => [unit.reading, unit.beginMs, unit.endMs])])),
      background: doc.lines.filter((line: any) => line.backgroundOf).map((line: any) => [doc.lines.findIndex((item: any) => item.id === line.backgroundOf), line.beginMs, line.endMs]),
      translation: doc.translationTracks.flatMap((track: any) => track.contents.map((content: any) => [doc.lines.findIndex((line: any) => line.id === content.lineId), content.text])) });
    return { draft: shape(draft), final: shape(final), romanPreserved: JSON.stringify(before.romanizationTracks) === JSON.stringify(draft.romanizationTracks) };
  }, { original, xml: saved.document.lyrics.draftTtml });
  expect(results.romanPreserved).toBe(true);
  expect(results.final).toEqual(results.draft);
  expect(results.draft.words).toEqual([[['今日', 1000, 3000, [['きょう', 1000, 2800]]]], [['は', 3000, 4000, []]], [['歌', 4000, 5000, []]]]);
  expect(results.draft.background).toEqual([[2, 500, 5500]]); expect(results.draft.translation).toEqual([[1, ' today ']]);
  await line.getByRole('button', { name: '添加词', exact: true }).click();
  await line.getByRole('textbox', { name: '添加词', exact: true }).fill(' 新 '); await line.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
  await expect(line.getByLabel('词  新 ', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(line.getByLabel('词  新 ', { exact: true })).toHaveValue(' 新 ');
  const added = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  const newWord = await page.evaluate(async xml => { const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path); return codec.parseLyricTtml(xml).lines[0].words.at(-1); }, added.document.lyrics.draftTtml);
  expect(newWord).toMatchObject({ text: ' 新 ', beginMs: null, endMs: null });
});
