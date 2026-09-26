import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { toAmllLines } from '../src/domain/preview-adapter';

it('maps timed Ruby, translations, background and duet without mutating a draft', () => {
  const document = createLyricDocument('歌');
  const main = document.lines[0]; main.beginUs = 1_000_000; main.endUs = 2_000_000; main.duet = true;
  main.words[0].beginUs = 1_000_000; main.words[0].endUs = 2_000_000;
  main.words[0].rubyUnits = [{ id: 'ruby', reading: 'うた', beginUs: 1_000_000, endUs: 2_000_000 }];
  main.translations = [{ language: 'en', text: 'song' }];
  const bg = createLine('ah'); bg.backgroundOf = main.id; bg.beginUs = 1_200_000; bg.endUs = 1_800_000;
  document.lines.push(bg);
  const mapped = toAmllLines(document, true, false);
  expect(mapped.map((line) => line.lyric.isBG)).toEqual([false, true]);
  expect(mapped[0].lyric).toMatchObject({ isDuet: true, translatedLyric: 'song', words: [{ ruby: [{ word: 'うた', startTime: 1000, endTime: 2000 }] }] });
  expect(document.lines[0].words[0].rubyUnits[0].beginUs).toBe(1_000_000);
});
