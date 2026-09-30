import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { phase7Ttml } from '../fixtures/phase7';

test('P7 linked split, translation ownership and generated timed track persist through actual service and final export', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  const xml = await page.evaluate(async xml => {
    const codecPath = '/src/adapters/ttml/lyric-codec.ts', commandPath = '/src/domain/lyric-commands.ts';
    const codec = await import(codecPath) as typeof import('../../src/adapters/ttml/lyric-codec');
    const commands = await import(commandPath) as typeof import('../../src/domain/lyric-commands');
    const doc = codec.parseLyricTtml(xml);
    doc.lines[1].translations = [{ language: 'en', text: 'first' }, { language: 'zh-Hans', text: '后行' }];
    let state = commands.createLyricEditorState(doc);
    state = commands.executeLyricCommand(state, { type: 'link-line-end', lineId: 'kana', targetLineId: 'context' });
    state = commands.executeLyricCommand(state, { type: 'link-line-end', lineId: 'context', targetLineId: 'missing' });
    return codec.serializeLyricTtml(state.present, { draft: true });
  }, phase7Ttml);
  await page.locator('input[type=file]').last().setInputFiles({ name: 'phase7.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(3);
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const generation = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  await generation.getByLabel('输出', { exact: true }).selectOption('timed'); await generation.getByRole('button', { name: '生成音译', exact: true }).click();
  await outline.nth(1).click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  const split = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await split.getByLabel('翻译 2归属').selectOption('right'); await split.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  const semantics = async (xml: string) => page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const { parseLyricTtml } = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const doc = parseLyricTtml(xml); return { lines: doc.lines.map(line => ({ id: line.id, beginUs: line.beginUs, endUs: line.endUs, endLink: line.endLink, translations: line.translations, text: line.words.map(w => w.text).join(''), reading: line.words.flatMap(w => w.rubyUnits.map(r => r.reading)) })), tracks: doc.romanizationTracks };
  }, xml);
  const draft = await semantics(saved.document.ttml);
  expect(draft.lines[0].endLink).toEqual({ targetLineId: 'context', originalEndUs: 4e6 });
  expect(draft.lines[1]).toMatchObject({ endLink: null, endUs: 5e6, translations: [{ language: 'en', text: 'first' }] });
  expect(draft.lines[2]).toMatchObject({ endLink: { targetLineId: 'missing', originalEndUs: 6e6 }, translations: [{ language: 'zh-Hans', text: '后行' }] });
  expect(draft.tracks[0]).toMatchObject({ language: 'ja-Latn', contents: [{ kind: 'timed', units: [{ text: 'ga ', beginUs: 0, endUs: 1e6 }, { text: 'k ', beginUs: 1e6, endUs: 2e6 }, { text: 'ko ', beginUs: 2e6, endUs: 3e6 }, { text: 'u', beginUs: 3e6, endUs: 4e6 }] }] });
  await page.reload(); await expect(outline).toHaveCount(4);
  await page.locator('[data-top-menu="file"] summary').click(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: '最终 TTML', exact: true }).click();
  const finalXml = await readFile(await (await download).path(), 'utf8'); const final = await semantics(finalXml);
  expect(final.lines.map(({ endLink: _link, ...line }) => line)).toEqual(draft.lines.map(({ endLink: _link, ...line }) => line));
  expect(final.lines.every(line => line.endLink === null)).toBe(true);
  await page.locator('input[type=file]').last().setInputFiles({ name: 'final.ttml', mimeType: 'application/xml', buffer: Buffer.from(finalXml) });
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveValue('ga ');
  await writeFile(test.info().outputPath('roundtrip.json'), JSON.stringify({ draft, final }, null, 2));
});

test('P7 actual review export preserves semantic fields and emits untimed spaces as text nodes', async ({ page }) => {
  test.skip(!process.env.STUDIO_PHASE6_REVIEW_TTML, 'Provide the Phase 6 review export explicitly.');
  const original = await readFile(process.env.STUDIO_PHASE6_REVIEW_TTML!, 'utf8');
  await page.goto('/editor');
  const result = await page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const before = codec.parseLyricTtml(xml), output = codec.serializeLyricTtml(before), after = codec.parseLyricTtml(output);
    const semantic = (doc: typeof before) => ({ lines: doc.lines.map(line => ({ text: line.words.map(word => word.text).join(''), beginUs: line.beginUs, endUs: line.endUs, agentRefs: line.agentRefs, translations: line.translations, words: line.words.map(({ id: _id, rubyUnits, ...word }) => ({ ...word, rubyUnits: rubyUnits.map(({ id: _id, ...unit }) => unit) })) })), tracks: doc.romanizationTracks.map(({ id: _id, contents, ...track }) => ({ ...track, contents: contents.map(({ id: _id, ...content }) => content.kind === 'plain' ? content : { ...content, units: content.units.map(({ id: _id, ...unit }) => unit) }) })) });
    const packingPath = '/src/domain/pack-intervals.ts'; const { packIntervals } = await import(packingPath) as typeof import('../../src/domain/pack-intervals');
    const intervals = before.lines.filter(line => !line.backgroundOf && line.beginUs !== null && line.endUs !== null && line.endUs > 266689000 && line.beginUs < 278949000).map(line => ({ key: line.id, beginUs: line.beginUs!, endUs: line.endUs! }));
    const packed = packIntervals(intervals);
    const compact = { startUs: 266689000, endUs: 278949000, count: intervals.length, laneCount: packed.laneCount, lanes: [...packed.lanes.values()] };
    const root = new DOMParser().parseFromString(output, 'application/xml');
    return { before: semantic(before), after: semantic(after), output, compact, spaces: Array.from(root.querySelectorAll('p')).flatMap(p => Array.from(p.childNodes).filter(n => n.nodeType === Node.TEXT_NODE && /^\s+$/.test(n.textContent ?? '')).map(n => n.textContent)) };
  }, original);
  expect(result.after).toEqual(result.before); expect(result.spaces.length).toBeGreaterThan(0); expect(result.compact.count).toBe(4); expect(result.compact.laneCount).toBe(1);
  await writeFile(test.info().outputPath('review-export.json'), JSON.stringify({ source: process.env.STUDIO_PHASE6_REVIEW_TTML, lines: result.before.lines.length, whitespaceTextNodes: result.spaces.length, result: 'semantic equality', compact: result.compact }, null, 2));
});
