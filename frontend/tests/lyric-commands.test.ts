import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord, lineText } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, redoLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { codePointToUtf16, splitAtGrapheme, utf16ToCodePoint } from '../src/domain/text-boundaries';

describe('semantic lyric commands', () => {
  it('splits untimed text without losing spaces and keeps unrelated lines shared', () => {
    const document = createLyricDocument('今日 も歌う');
    const [line] = document.lines;
    const wordId = line.words[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'split-word', lineId: line.id, wordId, at: 2, newWordId: 'after-today' });
    expect(state.present.lines[0].words.map((word) => [word.id, word.text, word.beginUs])).toEqual([
      [wordId, '今日', null], ['after-today', ' も歌う', null],
    ]);
    expect(lineText(state.present.lines[0])).toBe('今日 も歌う');
    expect(undoLyricCommand(state).present).toBe(document);
    expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
  });

  it('keeps word timing when editing neighboring text and splits 注音 reading once', () => {
    const document = createLyricDocument('今日も歌う');
    const lineId = document.lines[0].id;
    const firstId = document.lines[0].words[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'split-word', lineId, wordId: firstId, at: 2, newWordId: 'rest' });
    state = executeLyricCommand(state, { type: 'add-ruby', lineId, wordId: firstId, reading: 'きょう', rubyId: 'reading' });
    state = executeLyricCommand(state, { type: 'split-ruby', lineId, wordId: firstId, rubyId: 'reading', at: 2, newRubyId: 'reading-tail' });
    state = executeLyricCommand(state, { type: 'set-word-time', lineId, wordId: 'rest', beginUs: 1_000_000, endUs: 2_000_000 });
    state = executeLyricCommand(state, { type: 'edit-word', lineId, wordId: 'rest', text: 'も唄う' });
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['きょ', 'う']);
    expect(state.present.lines[0].words[1]).toMatchObject({ text: 'も唄う', beginUs: 1_000_000, endUs: 2_000_000 });
    expect(undoLyricCommand(state).present.lines[0].words[1]).toMatchObject({ text: 'も歌う', beginUs: 1_000_000 });
    expect(() => executeLyricCommand(state, { type: 'split-word', lineId, wordId: firstId, at: 1 })).toThrow(/拆分带注音的正文/);
  });

  it('reorders 注音 only within its word while preserving unit identity and timing', () => {
    const document = createLyricDocument('歌');
    const line = document.lines[0], word = line.words[0];
    word.rubyUnits = [
      { id: 'one', reading: 'う', beginUs: 100_000, endUs: 200_000 },
      { id: 'two', reading: 'た', beginUs: 200_000, endUs: 300_000 },
    ];
    const state = createLyricEditorState(document);
    const moved = executeLyricCommand(state, { type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId: 'two', afterRubyId: null });
    expect(moved.present.lines[0].words[0].rubyUnits[0]).toBe(word.rubyUnits[1]);
    expect(undoLyricCommand(moved).present).toBe(document);
    expect(() => executeLyricCommand(state, { type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId: 'two', afterRubyId: 'elsewhere' })).toThrow(/目标位置/);
  });

  it('uses grapheme boundaries across UTF-16 and code points', () => {
    const text = '𝄞e\u0301きょ';
    expect(codePointToUtf16(text, 1)).toBe(2);
    expect(utf16ToCodePoint(text, 2)).toBe(1);
    expect(() => utf16ToCodePoint(text, 1)).toThrow(/surrogate/);
    expect(() => splitAtGrapheme(text, 2)).toThrow(/grapheme/);
    expect(splitAtGrapheme(text, 3)).toEqual(['𝄞e\u0301', 'きょ']);
  });

  it('keeps background vocals with their parent through line edits and undo', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    const second = createLine('第二行', 'second');
    document.lines.push(background, second);
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'move-line', lineId: parent.id, afterLineId: second.id });
    expect(state.present.lines.map((line) => line.id)).toEqual(['second', parent.id, 'bg']);
    expect(undoLyricCommand(state).present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', 'second']);
    state = executeLyricCommand(state, { type: 'delete-line', lineId: parent.id });
    expect(state.present.lines.map((line) => line.id)).toEqual(['second']);
    expect(undoLyricCommand(state).present.lines.map((line) => line.id)).toEqual(['second', parent.id, 'bg']);
  });

  it('turns an existing row into a background relation and restores it in one undo', () => {
    const document = createLyricDocument('主唱');
    const main = document.lines[0];
    const background = createLine('和声', 'bg');
    const another = createLine('另一主行', 'another');
    document.lines.push(another, background);
    const original = createLyricEditorState(document);
    const attached = executeLyricCommand(original, { type: 'set-background-of', lineId: background.id, parentLineId: main.id });
    expect(attached.present.lines.map((line) => [line.id, line.backgroundOf])).toEqual([[main.id, null], ['bg', main.id], ['another', null]]);
    expect(undoLyricCommand(attached).present).toBe(document);
    expect(() => executeLyricCommand(attached, { type: 'set-background-of', lineId: another.id, parentLineId: main.id })).toThrow(/已有背景/);
    const detached = executeLyricCommand(attached, { type: 'set-background-of', lineId: background.id, parentLineId: null });
    expect(detached.present.lines[1]).toMatchObject({ id: 'bg', backgroundOf: null, words: background.words });
  });

  it('does not turn a line with attached transliteration into a background row', () => {
    const document = createLyricDocument('主唱');
    const candidate = createLine('保留音译', 'candidate');
    document.lines.push(candidate);
    document.romanizationTracks.push({ id: 'track', language: null, contents: [{ id: 'content', lineId: candidate.id, kind: 'plain', text: 'romaji' }] });
    expect(() => executeLyricCommand(createLyricEditorState(document), { type: 'set-background-of', lineId: candidate.id, parentLineId: document.lines[0].id })).toThrow(/音译内容/);
  });

  it('edits and reorders independent transliteration units in one undoable command each', () => {
    const document = createLyricDocument('二人');
    const lineId = document.lines[0].id;
    document.romanizationTracks.push({ id: 'track', language: 'ja-Latn', contents: [{ id: 'content', lineId, kind: 'timed', units: [
      { id: 'fu', text: 'fu ', beginUs: 999_000, endUs: 1_500_000 },
      { id: 'tari', text: 'tari', beginUs: 1_500_000, endUs: 3_001_000 },
    ] }] });
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'split-romanization-unit', trackId: 'track', contentId: 'content', unitId: 'tari', at: 2 });
    const content = state.present.romanizationTracks[0].contents[0];
    expect(content.kind).toBe('timed');
    if (content.kind !== 'timed') return;
    expect(content.units.map((unit) => unit.text)).toEqual(['fu ', 'ta', 'ri']);
    expect(content.units[2].endUs).toBe(3_001_000);
    const moved = executeLyricCommand(state, { type: 'move-romanization-unit', trackId: 'track', contentId: 'content', unitId: content.units[2].id, afterUnitId: null });
    const reordered = moved.present.romanizationTracks[0].contents[0];
    if (reordered.kind !== 'timed') return;
    expect(reordered.units[0]).toBe(content.units[2]);
    expect(undoLyricCommand(moved).present).toBe(state.present);
    const deleted = executeLyricCommand(moved, { type: 'delete-line', lineId });
    expect(deleted.present.romanizationTracks[0].contents).toEqual([]);
    expect(undoLyricCommand(deleted).present).toBe(moved.present);
  });

  it('splits and merges main lines with explicit transliteration and background ownership', () => {
    const document = createLyricDocument('前後');
    const main = document.lines[0];
    main.words = [createWord('前', 'front'), createWord('後', 'back')];
    main.beginUs = 0; main.endUs = 2_000_000;
    main.words[0].beginUs = 0; main.words[0].endUs = 1_000_000;
    main.words[1].beginUs = 1_000_000; main.words[1].endUs = 2_000_000;
    const bg = createLine('和声', 'bg');
    bg.beginUs = 1_200_000; bg.endUs = 1_800_000;
    document.lines.push(bg);
    document.romanizationTracks.push({ id: 'track', language: 'ja-Latn', contents: [
      { id: 'first', lineId: main.id, kind: 'plain', text: 'mae' },
      { id: 'second', lineId: main.id, kind: 'plain', text: 'ushiro' },
    ] });
    const original = createLyricEditorState(document);
    const withBackground = executeLyricCommand(original, { type: 'set-background-of', lineId: bg.id, parentLineId: main.id });
    expect(() => executeLyricCommand(withBackground, { type: 'split-line', lineId: main.id, beforeWordId: 'back', newLineId: 'right', translationIndicesForNewLine: [], contentIdsForNewLine: ['second'], backgroundTarget: null })).toThrow(/背景歌词归属/);
    const leftAssigned = executeLyricCommand(withBackground, { type: 'split-line', lineId: main.id, beforeWordId: 'back', newLineId: 'right', translationIndicesForNewLine: [], contentIdsForNewLine: ['second'], backgroundTarget: 'left' });
    expect(leftAssigned.present.lines.find(line => line.id === bg.id)).toMatchObject({ backgroundOf: main.id, beginUs: bg.beginUs, endUs: bg.endUs });
    const split = executeLyricCommand(withBackground, { type: 'split-line', lineId: main.id, beforeWordId: 'back', newLineId: 'right', translationIndicesForNewLine: [], contentIdsForNewLine: ['second'], backgroundTarget: 'right' });
    expect(split.present.lines.map((line) => [line.id, line.backgroundOf])).toEqual([[main.id, null], ['right', null], ['bg', 'right']]);
    expect(split.present.romanizationTracks[0].contents.map((content) => [content.id, content.lineId])).toEqual([['first', main.id], ['second', 'right']]);
    expect(undoLyricCommand(split).present).toBe(withBackground.present);
    const detached = executeLyricCommand(split, { type: 'set-background-of', lineId: 'bg', parentLineId: null });
    const merged = executeLyricCommand(detached, { type: 'merge-lines', firstLineId: main.id, secondLineId: 'right' });
    expect(merged.present.lines[0].words.map((word) => word.id)).toEqual(['front', 'back']);
    expect(merged.present.romanizationTracks[0].contents.map((content) => content.lineId)).toEqual([main.id, main.id]);
    expect(undoLyricCommand(merged).present).toBe(detached.present);
  });

  it('inserts and moves lines after the full background group', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    const second = createLine('第二行', 'second');
    document.lines.push(background, second);
    const inserted = executeLyricCommand(createLyricEditorState(document), { type: 'insert-line', afterLineId: parent.id, line: createLine('插入', 'new') });
    expect(inserted.present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', 'new', 'second']);
    const moved = executeLyricCommand(inserted, { type: 'move-line', lineId: 'new', afterLineId: parent.id });
    expect(moved).toBe(inserted);
    const movedParent = executeLyricCommand(inserted, { type: 'move-line', lineId: parent.id, afterLineId: second.id });
    expect(movedParent.present.lines.map((line) => line.id)).toEqual(['new', 'second', parent.id, 'bg']);
    expect(undoLyricCommand(movedParent).present).toBe(inserted.present);
  });

  it('inserts words and sublyrics as single undoable operations', () => {
    const document = createLyricDocument('今日');
    const lineId = document.lines[0].id;
    const first = document.lines[0].words[0];
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'insert-word', lineId, afterWordId: first.id, word: createWord(' も', 'next') });
    state = executeLyricCommand(state, { type: 'set-sublyrics', lineId, kind: 'translations', items: [{ language: 'zh', text: '今天也' }] });
    expect(lineText(state.present.lines[0])).toBe('今日 も');
    expect(state.present.lines[0].translations[0].text).toBe('今天也');
    expect(undoLyricCommand(state).present.lines[0].translations).toEqual([]);
    expect(undoLyricCommand(undoLyricCommand(state)).present).toBe(document);
    expect(() => executeLyricCommand(state, { type: 'insert-word', lineId, afterWordId: null, word: createWord('重', first.id) })).toThrow(/already exists/);
  });

  it('moves a timed 注音 word across lines without changing its identity or timing', () => {
    const document = createLyricDocument('今日');
    const first = document.lines[0];
    const second = createLine('明日', 'second');
    document.lines.push(second);
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'add-ruby', lineId: first.id, wordId: first.words[0].id, reading: 'きょう', rubyId: 'ruby' });
    state = executeLyricCommand(state, { type: 'set-ruby-time', lineId: first.id, wordId: first.words[0].id, rubyId: 'ruby', beginUs: 100_000, endUs: 800_000 });
    expect(state.present.lines[0].words[0]).toMatchObject({ beginUs: 100_000, endUs: 800_000 });
    const beforeMove = state.present;
    state = executeLyricCommand(state, { type: 'move-word', lineId: first.id, wordId: first.words[0].id, toLineId: second.id, afterWordId: null });
    expect(state.present.lines[1].words[0]).toBe(beforeMove.lines[0].words[0]);
    expect(undoLyricCommand(state).present).toBe(beforeMove);
    expect(() => executeLyricCommand(state, { type: 'set-ruby-time', lineId: second.id, wordId: first.words[0].id, rubyId: 'ruby', beginUs: 0, endUs: 800_000 })).toThrow(/超出正文词/);
  });

  it('applies several edits as one undo step and rejects a failed batch atomically', () => {
    const document = createLyricDocument('今日 も');
    const lineId = document.lines[0].id;
    const wordId = document.lines[0].words[0].id;
    const state = createLyricEditorState(document);
    const edited = executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'split-word', lineId, wordId, at: 2, newWordId: 'rest' },
      { type: 'edit-word', lineId, wordId: 'rest', text: ' も歌う' },
      { type: 'set-sublyrics', lineId, kind: 'translations', items: [{ language: 'zh', text: '今天也唱歌' }] },
    ] });
    expect(lineText(edited.present.lines[0])).toBe('今日 も歌う');
    expect(edited.past).toEqual([document]);
    expect(undoLyricCommand(edited).present).toBe(document);
    expect(() => executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'split-word', lineId, wordId, at: 2, newWordId: 'rest' },
      { type: 'edit-word', lineId, wordId: 'missing', text: '失敗' },
    ] })).toThrow(/Word not found/);
    expect(state.present).toBe(document);
  });
});

it.each(['child', 'translation', 'link', 'referenced'])('P3-05 rejects background %s without modifying document or history', reason => {
  const document = createLyricDocument('主唱');
  const main = document.lines[0], source = createLine('源歌词', 'source');
  main.beginUs = 1_000_000; main.endUs = 10_000_000;
  source.beginUs = 2_000_000; source.endUs = 3_000_000;
  document.lines.push(source);
  if (reason === 'child') document.lines.push({ ...createLine('子背景', 'child'), backgroundOf: source.id });
  if (reason === 'translation') source.translations.push({ language: 'zh', text: '译文保留' });
  if (reason === 'link') source.endLink = { targetLineId: main.id, originalEndUs: source.endUs };
  if (reason === 'referenced') main.endLink = { targetLineId: source.id, originalEndUs: main.endUs };
  const snapshot = structuredClone(document), state = createLyricEditorState(document);
  expect(() => executeLyricCommand(state, { type: 'set-background-of', lineId: source.id, parentLineId: main.id })).toThrow();
  expect(state.present).toEqual(snapshot);
  expect(state.past).toHaveLength(0);
});

it.each([[0, 500_000], [2_000_000, 5_000_000], [0, 5_000_000], [null, null]])('P4 background %s–%s preserves independent time on attach/rebind/detach and undo', (beginUs, endUs) => {
  const document = createLyricDocument('主行');
  const main = document.lines[0], source = createLine('背景', 'bg'), another = createLine('另一主行', 'another');
  main.beginUs = 1_000_000; main.endUs = 2_000_000;
  source.beginUs = beginUs; source.endUs = endUs;
  source.words[0].beginUs = beginUs; source.words[0].endUs = endUs;
  source.words[0].rubyUnits = [{ id: 'r', reading: '背景音', beginUs, endUs }];
  document.lines.push(source, another);
  const original = createLyricEditorState(document);
  const attached = executeLyricCommand(original, { type: 'set-background-of', lineId: source.id, parentLineId: main.id });
  expect(attached.present.lines[0]).toBe(main);
  expect(attached.present.lines[1]).toMatchObject({ backgroundOf: main.id, beginUs, endUs, words: source.words });
  expect(attached.past).toHaveLength(1);
  expect(undoLyricCommand(attached).present).toBe(document);
  const rebound = executeLyricCommand(attached, { type: 'set-background-of', lineId: source.id, parentLineId: another.id });
  expect(rebound.present.lines.find(line => line.id === source.id)).toMatchObject({ backgroundOf: another.id, beginUs, endUs, words: source.words });
  const detached = executeLyricCommand(rebound, { type: 'set-background-of', lineId: source.id, parentLineId: null });
  expect(detached.present.lines.find(line => line.id === source.id)).toMatchObject({ backgroundOf: null, beginUs, endUs, words: source.words });
});
