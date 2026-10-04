import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { toAmllLines } from '../src/domain/preview-adapter';
import { parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { readFileSync } from 'node:fs';

it('maps timed 注音, translations, background and duet without mutating a draft', () => {
  const document = createLyricDocument('歌');
  document.agents = [{ id: 'v1', name: null, type: 'person' }, { id: 'v2', name: null, type: 'person' }];
  const main = document.lines[0]; main.beginMs = 1000; main.endMs = 2000; main.agentRefs = ['v2'];
  main.words[0].beginMs = 1000; main.words[0].endMs = 2000;
  main.words[0].rubyUnits = [{ id: 'ruby', reading: 'うた', beginMs: 1000, endMs: 2000 }];
  main.translations = [{ trackId: 'translation-track-796', trackOrder: 0, contentOrder: 0, id: 'translation-796', purpose: 'subtitle' as const, kind: 'plain' as const,  language: 'en', text: 'song' }];
  const bg = createLine('ah'); bg.backgroundOf = main.id; bg.beginMs = 1200; bg.endMs = 1800;
  document.lines.push(bg);
  const lead = createLine('lead'); lead.agentRefs = ['v1']; lead.beginMs = 2000; lead.endMs = 3000;
  document.lines.push(lead);
  const mapped = toAmllLines(document, true, false);
  expect(mapped.map((line) => line.lyric.isBG)).toEqual([false, true, false]);
  expect(mapped[0].lyric).toMatchObject({ isDuet: true, translatedLyric: 'song', words: [{ ruby: [{ word: 'うた', startTime: 1000, endTime: 2000 }] }] });
  expect(document.lines[0].words[0].rubyUnits[0].beginMs).toBe(1000);
});

it('keeps all nine L4 syllables when the player cannot express their word grouping', () => {
  const document = parseLyricTtml(readFileSync('../tests/fixtures/ttml/phase2-powder-snow.ttml', 'utf8'));
  const before = document.romanizationTracks[0].contents.find((content) => content.lineId === 'L4');
  const preview = toAmllLines(document, false, true).find((item) => item.id === 'L4')?.lyric;
  expect(preview?.romanLyric).toBe('ko na yu ki ga so ra ka ra ');
  expect(document.romanizationTracks[0].contents.find((content) => content.lineId === 'L4')).toBe(before);
});

it('P4 projects independent background before, after and beyond its parent without extending parent', () => {
  const document = createLyricDocument('主行');
  const main = document.lines[0]; main.beginMs = 1000; main.endMs = 2000;
  const bg = createLine('背景'); bg.backgroundOf = main.id; bg.beginMs = 2000; bg.endMs = 5000;
  bg.words[0].beginMs = 2000; bg.words[0].endMs = 4000; document.lines.push(bg);
  for (const [beginMs, endMs] of [[2000, 5000], [0, 500], [0, 5000]]) {
    bg.beginMs = beginMs; bg.endMs = endMs;
    const snapshot = JSON.stringify(document), lines = toAmllLines(document, false, false);
    expect(lines[0].lyric).toMatchObject({ startTime: 1000, endTime: 2000, isBG: false });
    expect(lines[1].lyric).toMatchObject({ startTime: beginMs, endTime: endMs, isBG: true });
    expect(JSON.stringify(document)).toBe(snapshot);
  }
});

it('preserves independent spaces in order as 0–0 AMLL words, skips untimed ordinary text and leaves fallback intact', () => {
  const document = createLyricDocument(), line = createLine(''); document.lines = [line];
  line.beginMs = 0; line.endMs = 4000;
  line.words = [' ', 'I', '  ', 'still', ' ', 'love', '\t', 'you', '　', 'untimed'].map((text, index) => ({
    ...createLine(text).words[0], beginMs: /\S/u.test(text) && text !== 'untimed' ? index * 100 : null,
    endMs: /\S/u.test(text) && text !== 'untimed' ? (index + 1) * 100 : null,
  }));
  const before = structuredClone(document);
  for (const translation of [true, false]) for (const romanization of [true, false]) {
    const words = toAmllLines(document, translation, romanization)[0].lyric.words;
    expect(words.map(word => word.word).join('')).toBe(' I  still love\tyou　');
    expect(words.filter(word => /^\s+$/u.test(word.word)).every(word => word.startTime === 0 && word.endTime === 0)).toBe(true);
  }
  expect(document).toEqual(before);
  line.words.forEach(word => { word.beginMs = null; word.endMs = null; });
  expect(toAmllLines(document, false, false)[0].lyric.words[0].word).toBe(' I  still love\tyou　untimed');
});
