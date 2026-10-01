import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLine, createLyricDocument, lineText, rubyReading } from '../src/domain/lyric-document';
import { shiftLineTimes } from '../src/domain/batch-editing';

const simple = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="line-1">今日も歌う</p></body></tt>';

describe('semantic TTML codec', () => {
  const trackSemantics = (document: ReturnType<typeof parseLyricTtml>) => document.romanizationTracks.map((track) => ({
    language: track.language,
    contents: track.contents.map((content) => content.kind === 'plain'
      ? { lineId: content.lineId, kind: content.kind, text: content.text }
      : { lineId: content.lineId, kind: content.kind, units: content.units.map(({ text, beginUs, endUs }) => ({ text, beginUs, endUs })) }),
  }));

  it.each(['phase2-multitrack', 'phase2-powder-snow'])('roundtrips %s track order, references, units, timing and spaces', (name) => {
    const imported = parseLyricTtml(readFileSync(`../tests/fixtures/ttml/${name}.ttml`, 'utf8'));
    if (name === 'phase2-powder-snow') {
      expect(imported.romanizationTracks).toHaveLength(1);
      expect(imported.romanizationTracks[0].contents).toHaveLength(38);
      expect(imported.romanizationTracks[0].contents.flatMap((content) => content.kind === 'timed' ? content.units : [])).toHaveLength(355);
      const l4 = imported.romanizationTracks[0].contents.find((content) => content.lineId === 'L4');
      expect(l4?.kind).toBe('timed');
      if (l4?.kind === 'timed') {
        expect(l4.units).toHaveLength(9);
        expect(l4.units.slice(0, 2)).toMatchObject([{ text: 'ko ', beginUs: 129_983_000 }, { text: 'na ' }]);
      }
    } else {
      expect(imported.romanizationTracks.map((track) => track.language)).toEqual(['ja-Latn', 'ja-Latn', 'ja-Hira']);
      expect(imported.romanizationTracks.map((track) => track.contents.length)).toEqual([2, 1, 2]);
    }
    for (const draft of [true, false]) {
      const reopened = parseLyricTtml(serializeLyricTtml(imported, { draft }));
      expect(trackSemantics(reopened)).toEqual(trackSemantics(imported));
      if (draft) expect(reopened.romanizationTracks).toEqual(imported.romanizationTracks);
    }
  });

  it('imports, splits 注音, edits a neighboring word, undoes, saves and reopens', () => {
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

  it('keeps relative line, word and 注音 times in microseconds', () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div begin="1.5s"><p xml:id="relative" begin="250ms" end="2s"><span begin="0s" end="1s" tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text"><span begin="0s" end="500ms">きょ</span><span begin="500ms" end="1s">う</span></span></span></p></div></body></tt>';
    const document = parseLyricTtml(xml);
    expect(document.lines[0]).toMatchObject({ beginUs: 1_750_000, endUs: 3_500_000 });
    expect(document.lines[0].words[0]).toMatchObject({ beginUs: 1_750_000, endUs: 2_750_000 });
    expect(document.lines[0].words[0].rubyUnits.map((unit) => [unit.beginUs, unit.endUs])).toEqual([[1_750_000, 2_250_000], [2_250_000, 2_750_000]]);
    const reopened = parseLyricTtml(serializeLyricTtml(document, { draft: true }));
    expect(reopened.lines[0].words[0].rubyUnits.map((unit) => [unit.beginUs, unit.endUs])).toEqual([[1_750_000, 2_250_000], [2_250_000, 2_750_000]]);
  });

  it('imports AMLL generator namespaces and absolute minute timestamps without shifting words', () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" itunes:timing="Word"><head xmlns=""><metadata><ttm:agent type="person" xml:id="v1"/><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration><text for="L1"><span begin="2:09.983" end="2:10.500">yuki</span></text></transliteration></transliterations></iTunesMetadata><amll:meta key="musicName" value="Test"/></metadata></head><body xmlns="" dur="2:11.000"><div begin="2:09.000" end="2:11.000"><p begin="2:09.983" end="2:10.500" itunes:key="L1" ttm:agent="v1"><span begin="2:09.983" end="2:10.500">雪</span></p></div></body></tt>';
    const imported = parseLyricTtml(xml);
    expect(imported.lines[0]).toMatchObject({ beginUs: 129_983_000, endUs: 130_500_000, agentRefs: ['v1'] });
    expect(imported.lines[0].words[0]).toMatchObject({ text: '雪', beginUs: 129_983_000, endUs: 130_500_000 });
    expect(imported.romanizationTracks[0].contents[0]).toMatchObject({ lineId: 'L1', kind: 'timed', units: [{ text: 'yuki', beginUs: 129_983_000, endUs: 130_500_000 }] });
    expect(imported.metadata.title).toEqual(['Test']);
    const reopened = parseLyricTtml(serializeLyricTtml(imported));
    expect(reopened.lines[0].words[0].beginUs).toBe(129_983_000);
    expect(reopened.romanizationTracks[0].contents[0]).toMatchObject({ lineId: 'L1', kind: 'timed', units: [{ text: 'yuki' }] });
  });

  it('preserves finer AMLL transliteration timing as a separate track', () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head xmlns=""><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ja-Latn"><text for="L1"><span begin="2:09.983" end="2:10.161">ko </span><span begin="2:10.162" end="2:10.346">na </span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body xmlns="" dur="2:11.000"><div begin="2:09.000" end="2:11.000"><p begin="2:09.984" end="2:10.347" itunes:key="L1"><span begin="2:09.984" end="2:10.347">粉</span></p></div></body></tt>';
    const imported = parseLyricTtml(xml);
    expect(imported.romanizationTracks[0].language).toBe('ja-Latn');
    expect(imported.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [
      { text: 'ko ', beginUs: 129_983_000, endUs: 130_161_000 },
      { text: 'na ', beginUs: 130_162_000, endUs: 130_346_000 },
    ] });
    expect(parseLyricTtml(serializeLyricTtml(imported, { draft: true })).romanizationTracks).toEqual(imported.romanizationTracks);
    const shifted = shiftLineTimes(imported, ['L1'], 1_000_000);
    expect(shifted.type).toBe('replace-document');
    if (shifted.type === 'replace-document' && shifted.document.romanizationTracks[0].contents[0].kind === 'timed') expect(shifted.document.romanizationTracks[0].contents[0].units[0].beginUs).toBe(130_983_000);
  });

  it('keeps full clock timestamps relative when AMLL timing is absent', () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="00:00:01.000"><p begin="00:00:01.000" end="00:00:02.000">Test</p></div></body></tt>';
    expect(parseLyricTtml(xml).lines[0]).toMatchObject({ beginUs: 2_000_000, endUs: 3_000_000 });
  });

  it('rejects unknown inline structure instead of silently flattening it', () => {
    expect(() => parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p><x-translation>translation</x-translation></p></body></tt>')).toThrow(/Unsupported TTML line child/);
  });

  it('reads the reference tool 注音, translation, romanization and background sample', () => {
    const source = readFileSync('../tests/fixtures/ttml/reference-rich.ttml', 'utf8');
    const document = parseLyricTtml(source);
    expect(document.lines).toHaveLength(2);
    expect(lineText(document.lines[0])).toBe('今日も歌う');
    expect(document.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs, unit.endUs])).toEqual([
      ['きょ', 0, 500_000], ['う', 500_000, 1_000_000],
    ]);
    const state = createLyricEditorState(document);
    expect(() => executeLyricCommand(state, { type: 'set-word-time', lineId: document.lines[0].id, wordId: document.lines[0].words[0].id, beginUs: 600_000, endUs: 1_000_000 })).toThrow(/注音单元/);
    expect(document.lines[0].translations).toEqual([{ language: 'zh', text: '今天也唱歌' }]);
    expect(document.romanizationTracks[0]).toMatchObject({ language: 'ja-Latn', contents: [{ lineId: document.lines[0].id, kind: 'plain', text: 'kyou mo utau' }] });
    expect(document.lines[1]).toMatchObject({ backgroundOf: document.lines[0].id, beginUs: 500_000, endUs: 1_800_000 });
    expect(lineText(document.lines[1])).toBe('響く');
    const reopened = parseLyricTtml(serializeLyricTtml(document, { draft: true }));
    expect(reopened.lines.map(lineText)).toEqual(['今日も歌う', '響く']);
    expect(reopened.lines[0].words[0].rubyUnits).toEqual(document.lines[0].words[0].rubyUnits);
  });

  it('roundtrips timed per-word romanization from the reference tool', () => {
    const source = readFileSync('../tests/fixtures/ttml/reference-word-roman.ttml', 'utf8');
    const document = parseLyricTtml(source);
    expect(document.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [{ text: 'kyou' }, { text: 'sora' }] });
    expect(document.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['きょ', 'う']);
    for (const draft of [true, false]) {
      const output = serializeLyricTtml(document, { draft });
      expect(output).toContain(`<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">`);
      expect(output).toContain('itunes:key="L1"');
      const reopened = parseLyricTtml(output);
      expect(reopened.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [{ text: 'kyou' }, { text: 'sora' }] });
    }
  });

  it('keeps untimed track units in drafts and requires timing for exchange', () => {
    const document = createLyricDocument('今日');
    document.romanizationTracks.push({ id: 'track', language: null, contents: [{ id: 'content', lineId: document.lines[0].id, kind: 'timed', units: [{ id: 'unit', text: 'kyou', beginUs: null, endUs: null }] }] });
    expect(parseLyricTtml(serializeLyricTtml(document, { draft: true })).romanizationTracks).toEqual(document.romanizationTracks);
    expect(() => serializeLyricTtml(document)).toThrow(/needs timing/);
  });

  it.each(['amll', 'apple'])('roundtrips reference %s metadata, song part and background timing', (style) => {
    const source = readFileSync(`../tests/fixtures/ttml/reference-${style}-metadata.ttml`, 'utf8');
    const document = parseLyricTtml(source);
    expect(document.metadata).toMatchObject({ title: ['自作サンプル'], artist: ['Test'], songwriter: ['Composer'] });
    expect(document.lines.map(lineText)).toEqual(['今日 も歌う', '響く', '宇宙']);
    expect(document.lines[0].songPart).toBe('Verse');
    expect(document.lines[2]).toMatchObject({ agentRefs: ['v2'] });
    expect(document.lines[0].translations).toEqual([{ language: 'zh', text: '今天 也唱歌' }]);
    expect(document.romanizationTracks[0]).toMatchObject({ language: 'ja-Latn', contents: [{ lineId: document.lines[0].id, kind: 'plain', text: 'kyou mo utau' }] });
    expect(document.lines[1]).toMatchObject({ backgroundOf: 'L1', beginUs: 1_500_000, endUs: 2_700_000 });
    const state = createLyricEditorState(document);
    const edited = executeLyricCommand(state, { type: 'edit-word', lineId: 'L1', wordId: document.lines[0].words[1].id, text: ' も唄う' });
    const undone = undoLyricCommand(edited);
    expect(lineText(undone.present.lines[0])).toBe('今日 も歌う');
    const reopened = parseLyricTtml(serializeLyricTtml(undone.present, { draft: true }));
    expect(reopened.lines).toEqual(undone.present.lines);
    expect(reopened.metadata).toEqual(undone.present.metadata);
    const singerChanged = executeLyricCommand(state, { type: 'set-line-agents', lineId: 'L2', agentRefs: ['v1'] });
    expect(parseLyricTtml(serializeLyricTtml(singerChanged.present)).lines[2]).toMatchObject({ agentRefs: ['v1'] });
  });

  it('creates background vocals and metadata in one semantic document', () => {
    const document = createLyricDocument('今日');
    const parentLineId = document.lines[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'insert-line', afterLineId: parentLineId, line: createLine('響く', 'background') },
      { type: 'set-background-of', lineId: 'background', parentLineId },
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

it.each(['draft', 'exchange'] as const)('P4 %s roundtrip preserves independent background and extends only body duration', mode => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="parent" begin="1" end="2"><span begin="1" end="2">主行</span></p><p xml:id="background" begin="2" end="5"><span begin="2" end="4">背景</span></p></div></body></tt>');
  const attached = executeLyricCommand(createLyricEditorState(document), { type: 'set-background-of', lineId: 'background', parentLineId: 'parent' }).present;
  const xml = serializeLyricTtml(attached, { draft: mode === 'draft' });
  const tree = new DOMParser().parseFromString(xml, 'application/xml');
  expect(tree.getElementsByTagName('body')[0].getAttribute('dur')).toBe('5');
  const reopened = parseLyricTtml(xml);
  if (mode === 'draft') expect(reopened.lines[1].id).toBe('background');
  expect(reopened.lines[0]).toMatchObject({ beginUs: 1_000_000, endUs: 2_000_000 });
  expect(reopened.lines[1]).toMatchObject({ backgroundOf: reopened.lines[0].id, beginUs: 2_000_000, endUs: 5_000_000, words: [{ beginUs: 2_000_000, endUs: 4_000_000 }] });
});
