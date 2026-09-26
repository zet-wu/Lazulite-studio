import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLine, createLyricDocument, lineText, rubyReading } from '../src/domain/lyric-document';

const simple = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="line-1">今日も歌う</p></body></tt>';

describe('semantic TTML codec', () => {
  it('imports, splits Ruby, edits a neighboring word, undoes, saves and reopens', () => {
    const imported = parseLyricTtml(simple);
    const lineId = imported.lines[0].id;
    const firstId = imported.lines[0].words[0].id;
    let state = createLyricEditorState(imported);
    state = executeLyricCommand(state, { type: 'split-word', lineId, wordId: firstId, at: 2, newWordId: 'word-rest' });
    state = executeLyricCommand(state, { type: 'add-ruby', lineId, wordId: firstId, reading: 'きょう', rubyId: 'ruby-main' });
    state = executeLyricCommand(state, { type: 'split-ruby', lineId, wordId: firstId, rubyId: 'ruby-main', at: 2, newRubyId: 'ruby-tail' });
    state = executeLyricCommand(state, { type: 'edit-word', lineId, wordId: 'word-rest', text: 'も唄う' });
    state = undoLyricCommand(state);
    const saved = serializeLyricTtml(state.present, { draft: true });
    const reopened = parseLyricTtml(saved);
    expect(reopened.lines[0].words.map((word) => word.id)).toEqual([firstId, 'word-rest']);
    expect(lineText(reopened.lines[0])).toBe('今日も歌う');
    expect(reopened.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['きょ', 'う']);
    expect(rubyReading(reopened.lines[0].words[0])).toBe('きょう');
    expect(reopened.lines[0].beginUs).toBeNull();
  });

  it('keeps relative line, word and Ruby times in microseconds', () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div begin="1.5s"><p xml:id="relative" begin="250ms" end="2s"><span begin="0s" end="1s" tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text"><span begin="0s" end="500ms">きょ</span><span begin="500ms" end="1s">う</span></span></span></p></div></body></tt>';
    const document = parseLyricTtml(xml);
    expect(document.lines[0]).toMatchObject({ beginUs: 1_750_000, endUs: 3_500_000 });
    expect(document.lines[0].words[0]).toMatchObject({ beginUs: 1_750_000, endUs: 2_750_000 });
    expect(document.lines[0].words[0].rubyUnits.map((unit) => [unit.beginUs, unit.endUs])).toEqual([[1_750_000, 2_250_000], [2_250_000, 2_750_000]]);
    const reopened = parseLyricTtml(serializeLyricTtml(document, { draft: true }));
    expect(reopened.lines[0].words[0].rubyUnits.map((unit) => [unit.beginUs, unit.endUs])).toEqual([[1_750_000, 2_250_000], [2_250_000, 2_750_000]]);
  });

  it('rejects unknown inline structure instead of silently flattening it', () => {
    expect(() => parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p><x-translation>translation</x-translation></p></body></tt>')).toThrow(/Unsupported TTML line child/);
  });

  it('reads the reference tool Ruby, translation, romanization and background sample', () => {
    const source = readFileSync('../docs/evidence/editor-e0/reference-rich.ttml', 'utf8');
    const document = parseLyricTtml(source);
    expect(document.lines).toHaveLength(2);
    expect(lineText(document.lines[0])).toBe('今日も歌う');
    expect(document.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs, unit.endUs])).toEqual([
      ['きょ', 0, 500_000], ['う', 500_000, 1_000_000],
    ]);
    const state = createLyricEditorState(document);
    expect(() => executeLyricCommand(state, { type: 'set-word-time', lineId: document.lines[0].id, wordId: document.lines[0].words[0].id, beginUs: 600_000, endUs: 1_000_000 })).toThrow(/Ruby unit/);
    expect(document.lines[0].translations).toEqual([{ language: 'zh', text: '今天也唱歌' }]);
    expect(document.lines[0].romanizations).toEqual([{ language: 'ja-Latn', text: 'kyou mo utau' }]);
    expect(document.lines[1]).toMatchObject({ backgroundOf: document.lines[0].id, beginUs: 500_000, endUs: 1_800_000 });
    expect(lineText(document.lines[1])).toBe('響く');
    const reopened = parseLyricTtml(serializeLyricTtml(document, { draft: true }));
    expect(reopened.lines.map(lineText)).toEqual(['今日も歌う', '響く']);
    expect(reopened.lines[0].words[0].rubyUnits).toEqual(document.lines[0].words[0].rubyUnits);
  });

  it('roundtrips timed per-word romanization from the reference tool', () => {
    const source = readFileSync('../docs/evidence/editor-e4/reference-word-roman.ttml', 'utf8');
    const document = parseLyricTtml(source);
    expect(document.lines[0].words.map((word) => word.romanization)).toEqual(['kyou', 'sora']);
    expect(document.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['きょ', 'う']);
    for (const draft of [true, false]) {
      const reopened = parseLyricTtml(serializeLyricTtml(document, { draft }));
      expect(reopened.lines[0].words.map((word) => word.romanization)).toEqual(['kyou', 'sora']);
    }
  });

  it('keeps untimed per-word romanization in drafts and requires timing for exchange', () => {
    const document = createLyricDocument('今日');
    document.lines[0].words[0].romanization = 'kyou';
    expect(parseLyricTtml(serializeLyricTtml(document, { draft: true })).lines[0].words[0].romanization).toBe('kyou');
    expect(() => serializeLyricTtml(document)).toThrow(/needs timing/);
  });

  it.each(['amll', 'apple'])('roundtrips reference %s metadata, song part and background timing', (style) => {
    const source = readFileSync(`../docs/evidence/editor-e0/reference-${style}-metadata.ttml`, 'utf8');
    const document = parseLyricTtml(source);
    expect(document.metadata).toMatchObject({ title: ['自作サンプル'], artist: ['Test'], songwriter: ['Composer'] });
    expect(document.lines.map(lineText)).toEqual(['今日 も歌う', '響く', '宇宙']);
    expect(document.lines[0].songPart).toBe('Verse');
    expect(document.lines[2]).toMatchObject({ duet: true, agentRefs: ['v2'] });
    expect(document.lines[0].translations).toEqual([{ language: 'zh', text: '今天 也唱歌' }]);
    expect(document.lines[0].romanizations).toEqual([{ language: 'ja-Latn', text: 'kyou mo utau' }]);
    expect(document.lines[1]).toMatchObject({ backgroundOf: 'L1', beginUs: 1_500_000, endUs: 2_700_000 });
    const state = createLyricEditorState(document);
    const edited = executeLyricCommand(state, { type: 'edit-word', lineId: 'L1', wordId: document.lines[0].words[1].id, text: ' も唄う' });
    const undone = undoLyricCommand(edited);
    expect(lineText(undone.present.lines[0])).toBe('今日 も歌う');
    const reopened = parseLyricTtml(serializeLyricTtml(undone.present, { draft: true }));
    expect(reopened.lines).toEqual(undone.present.lines);
    expect(reopened.metadata).toEqual(undone.present.metadata);
    const duetOff = executeLyricCommand(state, { type: 'set-duet', lineId: 'L2', duet: false });
    expect(parseLyricTtml(serializeLyricTtml(duetOff.present)).lines[2]).toMatchObject({ duet: false, agentRefs: ['v1'] });
  });

  it('creates background vocals and metadata in one semantic document', () => {
    const document = createLyricDocument('今日');
    const parentLineId = document.lines[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'insert-background', parentLineId, line: createLine('響く', 'background') },
      { type: 'set-metadata', key: 'title', values: ['自作サンプル'] },
    ] });
    const reopened = parseLyricTtml(serializeLyricTtml(state.present, { draft: true }));
    expect(reopened.lines.map(lineText)).toEqual(['今日', '響く']);
    expect(reopened.lines[1].backgroundOf).toBe(parentLineId);
    expect(reopened.metadata.title).toEqual(['自作サンプル']);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('keeps attached mora timing in a draft without writing it to exchange TTML', () => {
    const document = parseLyricTtml(simple);
    const word = document.lines[0].words[0];
    word.alignmentUnits.push({ id: 'mora-1', kind: 'mora', text: 'きょ', beginUs: 100_000, endUs: 300_000, readingStart: 0, readingEnd: 2, rubyUnitId: null });
    const draft = serializeLyricTtml(document, { draft: true });
    expect(parseLyricTtml(draft).lines[0].words[0].alignmentUnits).toEqual(word.alignmentUnits);
    expect(serializeLyricTtml(document)).not.toContain('mora-1');
  });
});
