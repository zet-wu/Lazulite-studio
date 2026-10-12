import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { proposeRomanization, romanizationGenerationCommand } from '../src/domain/romanization-generation';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
const choices = { trackId: null, targets: {} };
function source(parts: string[], ruby = false) {
  const doc = createLyricDocument();
  const units = parts.map((reading, i) => ({ id: `u${i}`, reading, beginMs: 101 + i * 103, endMs: 200 + i * 103 }));
  doc.lines[0].beginMs = 0; doc.lines[0].endMs = 10000;
  doc.lines[0].words = ruby ? [{ ...createWord('正文', 'base'), beginMs: 0, endMs: 10000, rubyUnits: units }]
    : units.map(unit => ({ ...createWord(unit.reading, unit.id), beginMs: unit.beginMs, endMs: unit.endMs }));
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
    expect(rows[0].groups.map(unit => [unit.beginMs, unit.endMs])).toEqual(parts.map((_, i) => [101 + i * 103, 200 + i * 103]));
    if (ruby) expect(rows[0].groups.every(unit => unit.wordId === 'base')).toBe(true);
    expect(proposeRomanization(doc, [doc.lines[0].id])[0].text).toBe(output.join(''));
  }
});
it('filters empty timed units, preserves valid times, roundtrips final/draft and undoes once', () => {
  const doc = source(['が', 'っ', 'こ', 'う', '漢字'], true), before = structuredClone(doc);
  const rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
  rows[0].groups[0].text = 'manual  '; rows[0].groups[4].text = '';
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  expect(doc).toEqual(before); expect(result.present.lines).toEqual(before.lines);
  for (const draft of [true, false]) {
    const content = parseLyricTtml(serializeLyricTtml(result.present, { draft })).romanizationTracks[0].contents[0];
    expect(content.kind).toBe('timed');
    if (content.kind === 'timed') expect(content.units.map(({ text, beginMs, endMs }) => ({ text, beginMs, endMs }))).toEqual(rows[0].groups.filter(unit => unit.text.trim()).map(({ text, beginMs, endMs }) => ({ text, beginMs, endMs })));
  }
  expect(result.past).toHaveLength(1); expect(undoLyricCommand(result).present).toBe(doc);
});
it('keeps missing times and isolates line-final sokuon from the next line', () => {
  const doc = createLyricDocument('っ'); doc.lines.push(createLine('ち'));
  const rows = proposeRomanization(doc, doc.lines.map(line => line.id), 'timed');
  expect(rows[0].groups[0]).toMatchObject({ text: ' ', beginMs: null, endMs: null });
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  expect(() => serializeLyricTtml(result.present)).toThrow('needs timing');
  expect(parseLyricTtml(serializeLyricTtml(result.present, { draft: true })).romanizationTracks[0].contents).toHaveLength(1);
});
it('applies current ordinary text without converting again and preserves non-target contents', () => {
  const doc = source(['漢字', 'かな']); const lineId = doc.lines[0].id;
  doc.romanizationTracks = [{ id: 'track', language: 'ja-Latn', contents: [{ id: 'keep', lineId, kind: 'plain', text: 'keep' }, { id: 'replace', lineId, kind: 'plain', text: 'old' }] }];
  const rows = proposeRomanization(doc, [lineId]); rows[0].text = '  edited  ';
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'track', targets: {} })).toThrow('没有可生成内容');
  const opts = { trackId: 'track', targets: { [lineId]: 'replace' } };
  const state = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, opts));
  expect(state.present.romanizationTracks[0].contents).toEqual([doc.romanizationTracks[0].contents[0], { id: 'replace', lineId, kind: 'plain', text: '  edited  ' }]);
  expect(() => romanizationGenerationCommand({ ...doc }, doc, rows, opts)).toThrow('文档已变化');
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'missing', targets: {} })).toThrow('ja-Latn');
  expect(() => romanizationGenerationCommand(doc, doc, rows, { trackId: 'track', targets: { [lineId]: 'missing' } })).toThrow('不存在');
});

it('attaches all whitespace without extending times, preserves empty replacements and manual additions', () => {
  const doc = source([' ', 'か', '  ', 'な', '\t', 'English']);
  const rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
  rows[0].groups[2].beginMs = null;
  rows[0].groups[5].text = 'manual';
  const state = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  const content = state.present.romanizationTracks[0].contents[0];
  expect(content.kind === 'timed' && content.units.map(unit => [unit.text, unit.beginMs, unit.endMs])).toEqual([
    [' ka  ', 204, 303], ['na\t', 410, 509], ['manual', 616, 715],
  ]);
  const track = state.present.romanizationTracks[0];
  const empty = rows.map(row => ({ ...row, groups: row.groups.map(unit => ({ ...unit, text: ' \t　' })) }));
  expect(() => romanizationGenerationCommand(doc, doc, empty, choices)).toThrow('没有可生成内容');
  expect(() => romanizationGenerationCommand(state.present, state.present, empty, { trackId: track.id, targets: { [doc.lines[0].id]: content.id } })).toThrow('没有可生成内容');
  expect(track.contents[0]).toBe(content);
});
it('omits empty results with every timing shape and retains English text with valid Ruby', () => {
  for (const times of [[null, null], [100, null], [null, 200], [100, 200]] as const) {
    const doc = source(['漢字', 'か']);
    doc.lines[0].words[0].beginMs = times[0]; doc.lines[0].words[0].endMs = times[1];
    const rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
    rows[0].groups[0].text = '\t　';
    const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
    const content = result.present.romanizationTracks[0].contents[0];
    expect(content.kind === 'timed' && content.units).toEqual([expect.objectContaining({ text: '\t　ka', beginMs: 204, endMs: 303 })]);
  }
  const doc = source(['かな'], true); doc.lines[0].words[0].text = 'English';
  const rows = proposeRomanization(doc, [doc.lines[0].id], 'timed');
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, choices));
  expect(result.present.romanizationTracks[0].contents[0]).toMatchObject({kind:'timed', units:[{text:'kana'}]});
});
it('preserves empty replacement lines while generating another line and keeps plain spacing', () => {
  const doc = source(['か']); doc.lines.push(createLine('な'));
  const lineId = doc.lines[0].id;
  doc.romanizationTracks = [{id:'existing',language:'ja-Latn',contents:[{id:'keep',lineId,kind:'plain',text:'old'}]}];
  const rows = proposeRomanization(doc, doc.lines.map(line=>line.id), 'plain'); rows[0].text = ' \t　'; rows[1].text = '  manual  spacing  ';
  const state = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc,doc,rows,{trackId:'existing',targets:{[lineId]:'keep'}}));
  expect(state.present.romanizationTracks[0].contents).toEqual([doc.romanizationTracks[0].contents[0], expect.objectContaining({text:'  manual  spacing  '})]);
  expect(state.past).toHaveLength(1);
});
