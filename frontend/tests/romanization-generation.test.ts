import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { proposeRomanization, romanizationGenerationCommand, type RomanizationChoices, romanizeReading } from '../src/domain/romanization-generation';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
const choices = (): RomanizationChoices => ({ trackId: null, kind: 'plain', targets: {}, readings: {}, texts: {}, confirmed: new Set() });
it('converts whole word Ruby, NFC kana, sokuon, palatalization, nasal and long vowel context', () => {
  for (const [kana, text] of [['か\u3099っこう', 'gakkou'], ['キャ', 'kya'], ['しんよう', "shin'you"], ['スーパー', 'suupaa']]) expect(romanizeReading(kana)).toBe(text);
  const doc = createLyricDocument();
  doc.lines[0].words = [{ ...createWord('学校', 'school'), rubyUnits: ['が', 'っ', 'こ', 'う'].map((reading, i) => ({ id: String(i), reading, beginUs: i * 1e6, endUs: (i + 1) * 1e6 })) }];
  const rows = proposeRomanization(doc, [doc.lines[0].id]);
  expect(rows[0].groups[0]).toMatchObject({ text: 'gakkou', beginUs: 0, endUs: 4e6 });
  const before = structuredClone(doc);
  const opts = { ...choices(), kind: 'timed' as const };
  const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, opts));
  expect(result.present.lines).toEqual(before.lines); expect(doc).toEqual(before);
  for (const draft of [true, false]) {
    const track = parseLyricTtml(serializeLyricTtml(result.present, { draft })).romanizationTracks[0];
    expect(track.language).toBe('ja-Latn'); expect(track.contents[0]).toMatchObject({ kind: 'timed', units: [{ text: 'gakkou', beginUs: 0, endUs: 4e6 }] });
  }
  expect(result.past).toHaveLength(1); expect(undoLyricCommand(result).present).toBe(doc); expect(redoLyricCommand(undoLyricCommand(result)).present).toBe(result.present);
});
it('joins cross-word kana groups with explicit confirmation and leaves unknown timing unset', () => {
  for (const [parts, text] of [[['がっ', 'こう'], 'gakkou'], [['き', 'ゃ'], 'kya'], [['しん', 'よう'], "shin'you"]] as const) {
    const doc = createLyricDocument(); doc.lines[0].words = parts.map(part => createWord(part));
    const rows = proposeRomanization(doc, [doc.lines[0].id]);
    expect(rows[0].groups).toHaveLength(1); expect(rows[0].groups[0]).toMatchObject({ text, context: true, beginUs: null, endUs: null });
    expect(() => romanizationGenerationCommand(doc, doc, rows, choices())).toThrow('请确认跨词读音');
    const opts = { ...choices(), kind: 'timed' as const, confirmed: new Set([rows[0].groups[0].key]) };
    const result = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, opts));
    expect(() => serializeLyricTtml(result.present)).toThrow('needs timing');
    expect(parseLyricTtml(serializeLyricTtml(result.present, { draft: true })).romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [{ text, beginUs: null, endUs: null }] });
  }
});
it('requires missing kanji readings, preserves spaces and allows explicit local content replacement', () => {
  const doc = createLyricDocument(); doc.lines[0].words = [createWord('漢字', 'unknown'), createWord(' ', 'space'), createWord('かな', 'kana')];
  doc.lines.push(createLine('うた', 'other'));
  doc.romanizationTracks = [{ id: 'track', language: 'ja-Latn', contents: [{ id: 'keep', lineId: doc.lines[0].id, kind: 'plain', text: 'keep' }, { id: 'replace', lineId: doc.lines[0].id, kind: 'plain', text: 'old' }, { id: 'outside', lineId: 'other', kind: 'plain', text: 'untouched' }] }];
  const rows = proposeRomanization(doc, [doc.lines[0].id]);
  expect(rows[0].groups[0].reading).toBe('');
  expect(() => romanizationGenerationCommand(doc, doc, rows, choices())).toThrow('请补全日文假名读音');
  expect(() => romanizationGenerationCommand(doc, doc, rows, { ...choices(), trackId: 'track' })).toThrow('没有选择生成内容');
  const opts = { ...choices(), trackId: 'track', readings: { unknown: 'かんじ' }, texts: { kana: 'edited' }, targets: { [doc.lines[0].id]: 'replace' } };
  const state = executeLyricCommand(createLyricEditorState(doc), romanizationGenerationCommand(doc, doc, rows, opts));
  expect(state.present.romanizationTracks[0].contents).toEqual([doc.romanizationTracks[0].contents[0], { id: 'replace', lineId: doc.lines[0].id, kind: 'plain', text: 'kanji edited' }, doc.romanizationTracks[0].contents[2]]);
  expect(undoLyricCommand(state).present).toBe(doc);
  expect(() => romanizationGenerationCommand({ ...doc }, doc, rows, opts)).toThrow('文档已变化');
});
