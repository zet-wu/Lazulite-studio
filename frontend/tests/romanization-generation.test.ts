import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { proposeRomanization, romanizationGenerationCommand } from '../src/domain/romanization-generation';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
const choices = { trackId: null, targets: {} };
function source(parts: string[], ruby = false) {
  const doc = createLyricDocument();
  const units = parts.map((reading, i) => ({ id: `u${i}`, reading, beginUs: 100001 + i * 100003, endUs: 199999 + i * 100003 }));
  doc.lines[0].beginUs = 0; doc.lines[0].endUs = 10000000;
  doc.lines[0].words = ruby ? [{ ...createWord('正文', 'base'), beginUs: 0, endUs: 10000000, rubyUnits: units }]
    : units.map(unit => ({ ...createWord(unit.reading, unit.id), beginUs: unit.beginUs, endUs: unit.endUs }));
  return doc;
}
for (const [parts, output] of [
  [['が', 'っ', 'こ', 'う'], ['ga ', 'k ', 'ko ', 'u']],
  [['げっ', 'こ'], ['gek ', 'ko']], [['げ', 'っこ'], ['ge ', 'kko']],
  [['っ', 'ち'], ['t ', 'chi']], [['し', 'ん'], ['shi ', 'n']], [['しん'], ['shin']],
  [['しん', 'よう'], ['shin ', 'you']], [['しんあ'], ["shin'a"]],
  [['きゃ'], ['kya']], [['き', 'ゃ'], ['ky ', 'ya']], [['ギ', 'ュ'], ['gy ', 'yu']],
  [['コ', 'ー'], ['ko ', 'o']], [['こ', 'ー'], ['ko ', 'o']], [['スーパー'], ['suupaa']],
  [['か\u3099', 'っ', 'こう'], ['ga ', 'k ', 'kou']], [['ティ'], ['tei']], [['テ', 'ィ'], ['te ', 'i']],
  [['っ'], [' ']], [['こ', '漢字', 'ー'], ['ko', ' ', ' ']], [['っ', '漢字', 'か'], [' ', ' ', 'ka']],
  [[' ', 'こ', '  ', 'ん', '\t'], [' ', 'ko', '  ', 'n', '\t']],
] as Array<[string[], string[]]>) it(`maps ${parts.join('/')} with source boundaries and real times`, () => {
  for (const ruby of [false, true]) {
    const doc = source(parts, ruby), rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
    expect(rows[0].groups.map(unit => unit.text)).toEqual(output);
    expect(rows[0].groups.map(unit => [unit.beginUs, unit.endUs])).toEqual(parts.map((_, i) => [100001 + i * 100003, 199999 + i * 100003]));
    if (ruby) expect(rows[0].groups.every(unit => unit.wordId === 'base')).toBe(true);
    expect(proposeRomanization(doc, [doc.lines[0].id])[0].text).toBe(output.join(''));
  }
});
it('copies timed units exactly, accepts placeholders, roundtrips final/draft and undoes once', () => {
  const doc = source(['が', 'っ', 'こ', 'う', '漢字'], true), before = structuredClone(doc);
  const rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
  rows[0].groups[0].text = 'manual  '; rows[0].groups[4].text = '';
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  expect(doc).toEqual(before); expect(result.present.lines).toEqual(before.lines);
  for (const draft of [true, false]) {
    const content = parseLyricTtml(serializeLyricTtml(result.present, { draft })).romanizationTracks[0].contents[0];
    expect(content.kind).toBe('timed');
    if (content.kind === 'timed') expect(content.units.map(({ text, beginUs, endUs }) => ({ text, beginUs, endUs }))).toEqual(rows[0].groups.map(({ text, beginUs, endUs }) => ({ text: text || ' ', beginUs, endUs })));
  }
  expect(result.past).toHaveLength(1); expect(undoLyricCommand(result).present).toBe(doc);
});
it('keeps missing times and isolates line-final sokuon from the next line', () => {
  const doc = createLyricDocument('っ'); doc.lines.push(createLine('ち'));
  const rows = proposeRomanization(doc, doc.lines.map(line => line.id), 'timed');
  expect(rows[0].groups[0]).toMatchObject({ text: ' ', beginUs: null, endUs: null });
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  expect(() => serializeLyricTtml(result.present)).toThrow('needs timing');
  expect(parseLyricTtml(serializeLyricTtml(result.present, { draft: true })).romanizationTracks[0].contents).toHaveLength(2);
});
it('applies current ordinary text without converting again and preserves non-target contents', () => {
  const doc = source(['漢字', 'かな']); const lineId = doc.lines[0].id;
  doc.romanizationTracks = [{ id: 'track', language: 'ja-Latn', contents: [{ id: 'keep', lineId, kind: 'plain', text: 'keep' }, { id: 'replace', lineId, kind: 'plain', text: 'old' }] }];
  const rows = proposeRomanization(doc, [lineId]); rows[0].text = '  edited  ';
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'track', targets: {} })).toThrow('没有选择生成内容');
  const opts = { trackId: 'track', targets: { [lineId]: 'replace' } };
  const state = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, opts));
  expect(state.present.romanizationTracks[0].contents).toEqual([doc.romanizationTracks[0].contents[0], { id: 'replace', lineId, kind: 'plain', text: '  edited  ' }]);
  expect(() => romanizationGenerationCommand({ ...doc }, doc, rows, opts)).toThrow('文档已变化');
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'missing', targets: {} })).toThrow('ja-Latn');
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'track', targets: { [lineId]: 'missing' } })).toThrow('不存在');
});
