import { expect, it } from 'vitest';
import { importLyricFile } from '../src/adapters/lyric-formats';
it('keeps ordinary and both embedded word timing syntaxes', () => {
  const lrc = importLyricFile('[00:01.000]Hello world', 'lrc');
  expect(lrc.lines[0].beginMs).toBe(1000);
  for (const [kind, text] of [
    ['elrc', '[00:01.000]<00:01.000>Hello<00:02.000>world<00:03.000>'],
    ['eslrc', '[00:01.000]Hello[00:02.000]world[00:03.000]'],
  ] as const) {
    const doc = importLyricFile(text, kind);
    expect(doc.lines[0].words.map(w => [w.text, w.beginMs, w.endMs])).toEqual([['Hello',1000,2000],['world',2000,3000]]);
  }
});
