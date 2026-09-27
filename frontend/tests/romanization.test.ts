import { expect, it } from 'vitest';
import { createWord } from '../src/domain/lyric-document';
import { rubyReadingForWord } from '../src/domain/romanization';

it('converts an explicit romanization proposal without changing a source word', () => {
  const word = createWord('宇宙');
  expect(rubyReadingForWord(word, 'sora')).toBe('そら');
  expect(word.rubyUnits).toEqual([]);
  expect(rubyReadingForWord(createWord('きょう'), 'kyou')).toBeNull();
  expect(() => rubyReadingForWord(createWord('今日🎵'), 'kyou')).toThrow(/混合符号/);
  expect(() => rubyReadingForWord(createWord('宇宙'), 'sor?')).toThrow(/无法/);
});
