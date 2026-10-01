import { expect, it } from 'vitest';
import { parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { performanceTtml } from './fixtures/phase3';
it('uses a legal synthetic 2000-line / 20000-word fixture with 注音 and timed transliteration', () => {
  const xml = performanceTtml(), doc = parseLyricTtml(xml);
  expect(new TextEncoder().encode(xml).length).toBeLessThan(2 * 1024 * 1024);
  expect(doc.lines).toHaveLength(2000);
  expect(doc.lines.reduce((n, line) => n + line.words.length, 0)).toBe(20000);
  expect(doc.romanizationTracks[0].contents).toHaveLength(2000);
});
