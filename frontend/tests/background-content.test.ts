import { describe, expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { createLine, lineText } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { copySelection, pasteRich } from '../src/features/editor/editing-actions';
import { proposeRomanization, romanizationGenerationCommand } from '../src/domain/romanization-generation';
import { rubySourceRows, proposeRuby, rubyGenerationCommand } from '../src/domain/ruby-generation';
import { toAmllLines } from '../src/domain/preview-adapter';

const xml = (head: string, background: string) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><ttm:agent xml:id="v1" type="person"/><ttm:agent xml:id="v2" type="person"/>${head}</metadata></head><body><p itunes:key="L1" begin="1.000" end="4.000" ttm:agent="v1"><span begin="1.000" end="4.000">MAIN</span>${background}</p></body></tt>`;
const bg = '<span ttm:role="x-bg" begin="2.000" end="5.000" ttm:agent="v2 v1"><span begin="2.000" end="5.000">(かな)</span><span ttm:role="x-translation" xml:lang="zh"> 背景译文 </span><span ttm:role="x-roman" xml:lang="ja-Latn"> ka na </span></span>';
const fixture = () => parseLyricTtml(xml('', bg));

describe('background content and independent singers', () => {
  it('separates inline sublyrics from body and preserves ordered singers in draft/final roundtrips', () => {
    const d = fixture();
    expect(lineText(d.lines[1])).toBe('かな');
    expect(d.lines[1].agentRefs).toEqual(['v2', 'v1']);
    expect(d.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === d.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual([{ id: expect.any(String), purpose: 'subtitle' as const, kind: 'plain' as const,  language: 'zh', text: ' 背景译文 ' }]);
    expect(d.romanizationTracks[0].contents[0]).toMatchObject({ lineId: 'L1:bg', kind: 'plain', text: ' ka na ' });
    for (const draft of [true, false]) {
      const result = parseLyricTtml(serializeLyricTtml(d, { draft }));
      expect(result.lines.map(lineText)).toEqual(['MAIN', 'かな']);
      expect(result.lines[1].agentRefs).toEqual(['v2', 'v1']);
      expect(result.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === result.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual(d.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === d.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).map(item => ({ ...item, id: expect.any(String) })));
      expect(result.romanizationTracks[0].contents).toHaveLength(1);
      expect(result.romanizationTracks[0].contents[0]).toMatchObject({ lineId: 'L1:bg', text: ' ka na ' });
      if (draft) expect(result).toEqual(d);
    }
  });
  it('reads header background translations and timed romanization without inventing main content', () => {
    const head = '<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="en"><text for="L1"><span ttm:role="x-bg">( background )</span></text></translation></translations><transliterations><transliteration xml:lang="ja-Latn"><text for="L1">\n <span ttm:role="x-bg">(<span begin="2.000" end="3.000">ka </span><span begin="3.000" end="5.000">na</span>)</span>\n</text></transliteration></transliterations></iTunesMetadata>';
    const d = parseLyricTtml(xml(head, bg.replace(/<span ttm:role="x-roman"[^]*?<\/span>/, '')));
    expect(d.translationTracks[0].contents[0]).toMatchObject({ kind: 'plain', text: ' background ' });
    expect(d.romanizationTracks[0].contents).toHaveLength(1);
    expect(d.romanizationTracks[0].contents[0]).toMatchObject({ lineId: 'L1:bg', kind: 'timed', units: [{ text: 'ka ', beginMs: 2000, endMs: 3000 }, { text: 'na', beginMs: 3000, endMs: 5000 }] });
    expect(parseLyricTtml(serializeLyricTtml(d, { draft: true }))).toEqual(d);
  });
  it('keeps multiple contents, languages, empty drafts, and main/background texts distinct', () => {
    const d = fixture(), track = d.romanizationTracks[0];
    track.contents.unshift({ id: 'main', lineId: 'L1', kind: 'plain', text: ' main ' });
    track.contents.push({ id: 'bg2', lineId: 'L1:bg', kind: 'timed', units: [{ id: 'u', text: '  ', beginMs: null, endMs: 5000 }] });
    d.romanizationTracks.push({ id: 'second', language: 'en', contents: [{ id: 'empty', lineId: 'L1', kind: 'plain', text: '' }, { id: 'empty-bg', lineId: 'L1:bg', kind: 'timed', units: [] }] });
    expect(parseLyricTtml(serializeLyricTtml(d, { draft: true }))).toEqual(d);
    expect(() => serializeLyricTtml(d)).toThrow(/timing|no units/);
  });
  it('does not inherit missing agents and rejects unknown explicit agents or background references', () => {
    expect(parseLyricTtml(xml('', bg.replace(' ttm:agent="v2 v1"', ''))).lines[1].agentRefs).toEqual([]);
    expect(() => parseLyricTtml(xml('', bg.replace('v2 v1', 'missing')))).toThrow(/Unknown agent/);
    expect(() => parseLyricTtml(xml('<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration><text for="absent"><span ttm:role="x-bg">(x)</span></text></transliteration></transliterations></iTunesMetadata>', bg))).toThrow(/unknown parent/);
  });
  it('preserves background contents and singers through relationships, group copy/delete and undo', () => {
    const d = fixture(); d.lines.push({ ...createLine('next', 'next'), beginMs: 6000, endMs: 7000 });
    let state = createLyricEditorState(d);
    for (const parentLineId of ['next', null, 'L1']) {
      const before = state;
      state = executeLyricCommand(state, { type: 'set-background-of', lineId: 'L1:bg', parentLineId });
      expect(state.present.lines.find(l => l.id === 'L1:bg')).toMatchObject({ agentRefs: ['v2', 'v1'] });
      expect(state.present.romanizationTracks).toEqual(d.romanizationTracks);
      expect(undoLyricCommand(state).present).toBe(before.present);
    }
    state = executeLyricCommand(state, { type: 'set-line-agents', lineId: 'L1', agentRefs: [] });
    expect(state.present.lines.find(l => l.id === 'L1:bg')!.agentRefs).toEqual(['v2', 'v1']);
    const selection = { kind: 'lines' as const, ids: ['L1'], anchorId: 'L1', activeId: 'L1' };
    const copied = executeLyricCommand(state, pasteRich(state.present, copySelection(state.present, selection), selection).command);
    const clone = copied.present.lines.find(l => l.backgroundOf && l.id !== 'L1:bg')!;
    expect(copied.present.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === clone.id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual(d.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === d.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).map(item => ({ ...item, id: expect.any(String) })));
    expect(clone.agentRefs).toEqual(['v2', 'v1']);
    expect(copied.present.romanizationTracks[0].contents.find(c => c.lineId === clone.id)).toMatchObject({ text: ' ka na ' });
    expect(undoLyricCommand(copied).present).toBe(state.present);
    const deleted = executeLyricCommand(state, { type: 'delete-line', lineId: 'L1' });
    expect(deleted.present.romanizationTracks[0].contents).toEqual([]);
    expect(undoLyricCommand(deleted).present).toBe(state.present);
    const renamed = executeLyricCommand(state, { type: 'rename-agent', id: 'v2', nextId: 'backing' });
    expect(renamed.present.lines.find(l => l.id === 'L1:bg')!.agentRefs).toEqual(['backing', 'v1']);
    expect(executeLyricCommand(renamed, { type: 'delete-agent', id: 'backing' }).present.lines.find(l => l.id === 'L1:bg')!.agentRefs).toEqual(['v1']);
  });
  it('generates and converts using background source timings and previews its own singer', () => {
    const d = fixture(); d.romanizationTracks = []; d.lines[1].agentRefs = ['v2'];
    const rows = proposeRomanization(d, ['L1:bg'], 'timed');
    let state = executeLyricCommand(createLyricEditorState(d), romanizationGenerationCommand(d, d, rows, { trackId: null, targets: {} }));
    const track = state.present.romanizationTracks[0];
    expect(track.contents[0]).toMatchObject({ lineId: 'L1:bg', kind: 'timed', units: [{ text: 'kana', beginMs: 2000, endMs: 5000 }] });
    const proposed = proposeRuby(rubySourceRows(state.present, track.id, [track.contents[0].id]), 'hiragana');
    state = executeLyricCommand(state, rubyGenerationCommand(state.present, state.present, proposed, {}, new Set(), new Set()));
    expect(state.present.lines[1].words[0].rubyUnits[0]).toMatchObject({ reading: 'かな', beginMs: 2000, endMs: 5000 });
    expect(state.present.lines[0]).toEqual(d.lines[0]);
    expect(toAmllLines(state.present, true, true)[1].lyric).toMatchObject({ isBG: true, isDuet: true, translatedLyric: ' 背景译文 ' });
    expect(parseLyricTtml(serializeLyricTtml(state.present, { draft: true }))).toEqual(state.present);
  });
});

it('installed AMLL lyric library reads independent background sublyrics from final TTML', async () => {
  const { parseTTML } = await import('@applemusic-like-lyrics/lyric');
  const d = fixture();
  d.romanizationTracks[0].contents.unshift({ id: 'main', lineId: 'L1', kind: 'plain', text: 'main roman' });
  const consumer = parseTTML(serializeLyricTtml(d));
  // AMLL trims sublyric edges; Studio's own roundtrip above preserves them.
  expect(consumer.lines.find(line => line.isBG)).toMatchObject({ translatedLyric: '背景译文', romanLyric: 'ka na' });
  expect(consumer.lines.find(line => !line.isBG)?.romanLyric).toBe('main roman');
});

it('imports timed inline background romanization and preserves whitespace-only main content beside it', () => {
  const d = parseLyricTtml(xml('', bg.replace(' ka na </span>', '(<span begin="2.000" end="3.000">ka </span><span begin="3.000" end="5.000">na</span>)</span>')));
  expect(d.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [{ text: 'ka ', beginMs: 2000 }, { text: 'na', endMs: 5000 }] });
  d.romanizationTracks[0].contents.unshift({ id: 'space', lineId: 'L1', kind: 'plain', text: '  \n ' });
  const result = parseLyricTtml(serializeLyricTtml(d));
  expect(result.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'plain', text: '  \n ' });
  expect(result.romanizationTracks[0].contents[1]).toMatchObject({ kind: 'timed', units: [{ text: 'ka ', beginMs: 2000 }, { text: 'na', endMs: 5000 }] });
});
