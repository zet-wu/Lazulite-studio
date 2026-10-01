import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { phase7Ttml } from '../fixtures/phase7';
for (const kind of ['plain', 'timed']) test(`P8 ${kind} manual result and placeholders persist in real service and final TTML`, async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  await importLyrics(page, { name: 'phase8.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(3);
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] }); await outline.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  if (kind === 'timed') await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  const label = kind === 'timed' ? 'L1单元 1音译' : 'L1音译'; await dialog.getByLabel(label, { exact: true }).fill(' manual  ');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  const semantics = (xml: string) => page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const doc = codec.parseLyricTtml(xml);
    return { lines: doc.lines.map(line => ({ text: line.words.map(word => word.text).join(''), words: line.words.map(word => ({ text: word.text, beginMs: word.beginMs, endMs: word.endMs, ruby: word.rubyUnits.map(({ reading, beginMs, endMs }) => ({ reading, beginMs, endMs })) })) })), contents: doc.romanizationTracks[0].contents.map(content => content.kind === 'plain' ? { kind: content.kind, text: content.text } : { kind: content.kind, units: content.units.map(({ text, beginMs, endMs }) => ({ text, beginMs, endMs })) }) };
  }, xml);
  const draft = await semantics(saved.document.ttml);
  expect(draft.lines.map(line => line.text)).toEqual(['学校', 'しんよう', '漢字']);
  if (kind === 'plain') expect(draft.contents).toEqual([{ kind, text: ' manual  ' }, { kind, text: 'shin you' }, { kind, text: ' ' }]);
  else expect(draft.contents).toEqual([
    { kind, units: [{ text: ' manual  ', beginMs: 0, endMs: 1e3 }, { text: 'k ', beginMs: 1e3, endMs: 2e3 }, { text: 'ko ', beginMs: 2e3, endMs: 3e3 }, { text: 'u', beginMs: 3e3, endMs: 4e3 }] },
    { kind, units: [{ text: 'shin ', beginMs: 4e3, endMs: 5e3 }, { text: 'you', beginMs: 5e3, endMs: 6e3 }] },
    { kind, units: [{ text: ' ', beginMs: 6e3, endMs: 8e3 }] },
  ]);
  await page.reload(); await expect(outline).toHaveCount(3);
  await page.getByRole('button', { name: '文件打包', exact: true }).click(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const finalXml = await readFile(await (await download).path(), 'utf8'), final = await semantics(finalXml);
  expect(final).toEqual(draft); expect(finalXml).toContain('transliterations'); expect(finalXml).not.toContain('x-roman'); expect(finalXml).not.toContain('studio:');
  await importLyrics(page, { name: 'final.ttml', mimeType: 'application/xml', buffer: Buffer.from(finalXml) });
  await expect(page.getByLabel(kind === 'timed' ? '音译单元 1' : '音译 ja-Latn', { exact: true }).first()).toHaveValue(' manual  ');
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue(kind);
  expect(await dialog.getByLabel('目标轨道').inputValue()).not.toBe('');
  await expect(dialog.getByLabel('L1生成内容')).toHaveValue('skip');
  await expect(dialog.getByRole('button', { name: '生成音译', exact: true })).toBeDisabled();
  await writeFile(test.info().outputPath(`phase8-${kind}-roundtrip.json`), JSON.stringify({ draft, final }, null, 2));
});

test('Generation mode survives project reload and stays isolated across projects', async ({ page }) => {
  async function open(page: Page) {
    await page.locator('[data-outline-drag]').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
    return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  }
  await page.goto('/projects/phase4-background/edit'); let dialog = await open(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByLabel('L1单元 1音译').fill('discarded');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.reload(); dialog = await open(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await expect(dialog.getByLabel('L1单元 1音译')).not.toHaveValue('discarded');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/projects/phase2/edit'); dialog = await open(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/projects/phase4-background/edit'); dialog = await open(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); dialog = await open(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
});
