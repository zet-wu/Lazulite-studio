import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { toAmllLines } from '../src/domain/preview-adapter';
import { parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { readFileSync } from 'node:fs';

it('maps timed Ruby, translations, background and duet without mutating a draft', () => {
  const document = createLyricDocument('歌');
  document.agents = [{ id: 'v1', name: null, type: 'person' }, { id: 'v2', name: null, type: 'person' }];
  const main = document.lines[0]; main.beginUs = 1_000_000; main.endUs = 2_000_000; main.agentRefs = ['v2'];
  main.words[0].beginUs = 1_000_000; main.words[0].endUs = 2_000_000;
  main.words[0].rubyUnits = [{ id: 'ruby', reading: 'うた', beginUs: 1_000_000, endUs: 2_000_000 }];
  main.translations = [{ language: 'en', text: 'song' }];
  const bg = createLine('ah'); bg.backgroundOf = main.id; bg.beginUs = 1_200_000; bg.endUs = 1_800_000;
  document.lines.push(bg);
  const lead = createLine('lead'); lead.agentRefs = ['v1']; lead.beginUs = 2_000_000; lead.endUs = 3_000_000;
  document.lines.push(lead);
  const mapped = toAmllLines(document, true, false);
  expect(mapped.map((line) => line.lyric.isBG)).toEqual([false, true, false]);
  expect(mapped[0].lyric).toMatchObject({ isDuet: true, translatedLyric: 'song', words: [{ ruby: [{ word: 'うた', startTime: 1000, endTime: 2000 }] }] });
  expect(document.lines[0].words[0].rubyUnits[0].beginUs).toBe(1_000_000);
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
  const main = document.lines[0]; main.beginUs = 1_000_000; main.endUs = 2_000_000;
  const bg = createLine('背景'); bg.backgroundOf = main.id; bg.beginUs = 2_000_000; bg.endUs = 5_000_000;
  bg.words[0].beginUs = 2_000_000; bg.words[0].endUs = 4_000_000; document.lines.push(bg);
  for (const [beginUs, endUs] of [[2_000_000, 5_000_000], [0, 500_000], [0, 5_000_000]]) {
    bg.beginUs = beginUs; bg.endUs = endUs;
    const snapshot = JSON.stringify(document), lines = toAmllLines(document, false, false);
    expect(lines[0].lyric).toMatchObject({ startTime: 1000, endTime: 2000, isBG: false });
    expect(lines[1].lyric).toMatchObject({ startTime: beginUs / 1000, endTime: endUs / 1000, isBG: true });
    expect(JSON.stringify(document)).toBe(snapshot);
  }
});

it('preserves independent spaces in order as 0–0 AMLL words, skips untimed ordinary text and leaves fallback intact', () => {
  const document = createLyricDocument(), line = createLine(''); document.lines = [line];
  line.beginUs = 0; line.endUs = 4_000_000;
  line.words = [' ', 'I', '  ', 'still', ' ', 'love', '\t', 'you', '　', 'untimed'].map((text, index) => ({
    ...createLine(text).words[0], beginUs: /\S/u.test(text) && text !== 'untimed' ? index * 100_000 : null,
    endUs: /\S/u.test(text) && text !== 'untimed' ? (index + 1) * 100_000 : null,
  }));
  const before = structuredClone(document);
  for (const translation of [true, false]) for (const romanization of [true, false]) {
    const words = toAmllLines(document, translation, romanization)[0].lyric.words;
    expect(words.map(word => word.word).join('')).toBe(' I  still love\tyou　');
    expect(words.filter(word => /^\s+$/u.test(word.word)).every(word => word.startTime === 0 && word.endTime === 0)).toBe(true);
  }
  expect(document).toEqual(before);
  line.words.forEach(word => { word.beginUs = null; word.endUs = null; });
  expect(toAmllLines(document, false, false)[0].lyric.words[0].word).toBe(' I  still love\tyou　untimed');
});
