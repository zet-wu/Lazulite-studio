import { describe, expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { lineText, rubyReading } from '../src/domain/lyric-document';

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
});
