import { translationsForLine } from '../src/domain/lyric-document';
import { expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { collectOutputIssues } from '../src/adapters/output-validation';
import { applyLyricCommand } from '../src/domain/lyric-commands';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from './helpers/project-history';
import { shiftLineTimes } from '../src/domain/batch-editing';
import { copySelection, pasteRich } from '../src/features/editor/editing-actions';

// Apple metadata structure and extension namespace from AMLL specification §5.4;
// timing/text altered to make whitespace, independent bounds and track order observable.
export const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://itunes.apple.com/lyric-ttml-extensions" xml:space="preserve" itunes:timing="Word"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation type="replacement" xml:lang="zh-Hant"><text for="L1"><span begin="500ms" end="1.25s"> 黃金 </span><span begin="00:01.250" end="00:02.000">首飾</span><span ttm:role="x-bg">(<span begin="2s" end="3s"> 背景 </span>)</span></text><text for="L2">第二行</text></translation><translation xml:lang="en"><text for="L1"> plain </text></translation><translation type="subtitle" xml:lang="en"><text for="L1"><span begin="4s" end="5s"> outside </span></text></translation></translations></iTunesMetadata></metadata></head><body><p itunes:key="L1" begin="1s" end="2s"><span begin="1s" end="2s">正文</span><span ttm:role="x-bg" begin="2s" end="3s">(背景)</span></p><p itunes:key="L2" begin="3s" end="4s">第二</p></body></tt>`;
const semantics = (source: ReturnType<typeof parseLyricTtml>) => source.translationTracks.map(track => ({ language: track.language, purpose: track.purpose, contents: track.contents.map(({ id, ...item }) => item.kind === 'plain' ? item : { ...item, units: item.units.map(({ id, ...unit }) => unit) }) }));
it('reads external Apple translation purposes, multiple tracks and independent true endpoints without mixing body text', () => {
  const d = parseLyricTtml(xml);
  expect(d.lines[0].words.map(word => word.text).join('')).toBe('正文');
  expect(translationsForLine(d, d.lines[0].id)).toHaveLength(3);
  expect(translationsForLine(d, d.lines[0].id)[0]).toMatchObject({ kind: 'timed', units: [{ text: ' 黃金 ', beginMs: 500, endMs: 1250 }, { text: '首飾', beginMs: 1250, endMs: 2000 }] });
  expect(translationsForLine(d, d.lines[1].id)[0]).toMatchObject({ kind: 'timed', units: [{ text: ' 背景 ', beginMs: 2000, endMs: 3000 }] });
  expect(translationsForLine(d, d.lines[0].id)[1]).toMatchObject({ kind: 'plain', text: ' plain ' });
  const draft = serializeLyricTtml(d, { draft: true });
  expect(parseLyricTtml(draft)).toEqual(d);
  const final = serializeLyricTtml(d);
  expect(final).not.toContain('studio:');
  expect(final).not.toContain('x-translation');
  const parsed = new DOMParser().parseFromString(final, 'application/xml');
  expect(parsed.getElementsByTagNameNS('http://music.apple.com/lyric-ttml-internal', 'translation')).toHaveLength(3);
  expect(semantics(parseLyricTtml(final))).toEqual(semantics(d));
});
it('keeps missing translation endpoints in drafts and locates final output errors', () => {
  const d = parseLyricTtml(xml), content = translationsForLine(d, d.lines[0].id)[0];
  if (content.kind !== 'timed') throw Error('fixture');
  content.units[0].beginMs = null;
  expect(parseLyricTtml(serializeLyricTtml(d, { draft: true }))).toEqual(d);
  expect(collectOutputIssues(d, 'ttml')).toContainEqual(expect.objectContaining({ kind: 'translation-unit', lineId: 'L1', contentId: content.id, unitId: content.units[0].id, missing: ['begin'] }));
  expect(() => serializeLyricTtml(d)).toThrow(/needs timing/);
});
it('preserves translation structure through edits, relationships, grouped copy, explicit shifts and one undo', () => {
  const d = parseLyricTtml(xml);
  const moved = applyLyricCommand(d, shiftLineTimes(d, ['L1'], 200));
  expect(translationsForLine(moved, moved.lines[0].id)[0]).toMatchObject({ units: [{ beginMs: 700 }, { beginMs: 1450 }] });
  expect(moved.lines[1]).toBe(d.lines[1]);
  const detached = applyLyricCommand(d, { type: 'set-background-of', lineId: d.lines[1].id, parentLineId: null });
  expect(translationsForLine(detached, detached.lines[1].id)).toEqual(translationsForLine(d, d.lines[1].id));
  const clipboard = copySelection(d, { kind: 'lines', ids: ['L1'], anchorId: 'L1', activeId: 'L1' });
  const command = pasteRich(d, clipboard, { kind: 'lines', ids: ['L2'], anchorId: 'L2', activeId: 'L2' }).command;
  const state = executeLyricCommand(createLyricEditorState(d), command);
  expect(state.present.lines).toHaveLength(5);
  expect(translationsForLine(state.present, state.present.lines.at(-1)!.id)[0]).toMatchObject({ kind: 'timed' });
  expect(translationsForLine(state.present, state.present.lines.at(-1)!.id)[0].id).not.toBe(translationsForLine(d, d.lines[1].id)[0].id);
  expect(undoLyricCommand(state).present).toBe(d);
});
it('rejects unsupported translation types and nested data instead of flattening it', () => {
  expect(() => parseLyricTtml(xml.replace('type="replacement"', 'type="unknown"'))).toThrow(/type/);
  expect(() => parseLyricTtml(xml.replace(' 黃金 ', '<b>黃金</b>'))).toThrow(/structure/);
});
it('records installed AMLL consumer projection separately from Studio structured fidelity', async () => {
  const { parseTTML } = await import('@applemusic-like-lyrics/lyric');
  const d = parseLyricTtml(xml), final = serializeLyricTtml(d);
  const consumer = parseTTML(final);
  expect(consumer.lines.some(line => line.words.map(word => word.word).join('') === '正文')).toBe(true);
  // The reference library exposes a line string, without translation purpose or timed units.
  expect(typeof consumer.lines[0].translatedLyric).toBe('string');
  expect(consumer.lines[0]).not.toHaveProperty('translations');
  expect(semantics(parseLyricTtml(final))).toEqual(semantics(d));
});
