import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { phase7Ttml } from '../fixtures/phase7';
for (const kind of ['plain', 'timed']) test(`P8 ${kind} manual result and placeholders persist in real service and final TTML`, async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'phase8.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
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
    return { lines: doc.lines.map(line => ({ text: line.words.map(word => word.text).join(''), words: line.words.map(word => ({ text: word.text, beginUs: word.beginUs, endUs: word.endUs, ruby: word.rubyUnits.map(({ reading, beginUs, endUs }) => ({ reading, beginUs, endUs })) })) })), contents: doc.romanizationTracks[0].contents.map(content => content.kind === 'plain' ? { kind: content.kind, text: content.text } : { kind: content.kind, units: content.units.map(({ text, beginUs, endUs }) => ({ text, beginUs, endUs })) }) };
  }, xml);
  const draft = await semantics(saved.document.ttml);
  expect(draft.lines.map(line => line.text)).toEqual(['学校', 'しんよう', '漢字']);
  if (kind === 'plain') expect(draft.contents).toEqual([{ kind, text: ' manual  ' }, { kind, text: 'shin you' }, { kind, text: ' ' }]);
  else expect(draft.contents).toEqual([
    { kind, units: [{ text: ' manual  ', beginUs: 0, endUs: 1e6 }, { text: 'k ', beginUs: 1e6, endUs: 2e6 }, { text: 'ko ', beginUs: 2e6, endUs: 3e6 }, { text: 'u', beginUs: 3e6, endUs: 4e6 }] },
    { kind, units: [{ text: 'shin ', beginUs: 4e6, endUs: 5e6 }, { text: 'you', beginUs: 5e6, endUs: 6e6 }] },
    { kind, units: [{ text: ' ', beginUs: 6e6, endUs: 8e6 }] },
  ]);
  await page.reload(); await expect(outline).toHaveCount(3);
  await page.locator('[data-top-menu="file"] summary').click(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: '最终 TTML', exact: true }).click();
  const finalXml = await readFile(await (await download).path(), 'utf8'), final = await semantics(finalXml);
  expect(final).toEqual(draft); expect(finalXml).toContain('transliterations'); expect(finalXml).not.toContain('x-roman'); expect(finalXml).not.toContain('studio:');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'final.ttml', mimeType: 'application/xml', buffer: Buffer.from(finalXml) });
  await expect(page.getByLabel(kind === 'timed' ? '音译单元 1' : '音译 ja-Latn', { exact: true }).first()).toHaveValue(' manual  ');
  await writeFile(test.info().outputPath(`phase8-${kind}-roundtrip.json`), JSON.stringify({ draft, final }, null, 2));
});
