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
