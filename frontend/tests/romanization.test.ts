import { describe, expect, it } from 'vitest';
import { createLine, createWord } from '../src/domain/lyric-document';
import { rubyReadingForWord, suggestLineRomanization } from '../src/domain/romanization';

describe('romanization distribution', () => {
  it('maps exact space-separated tokens including exceptional readings', () => {
    const line = createLine('');
    line.words = [createWord('今日'), createWord(' '), createWord('宇宙')];
    expect(suggestLineRomanization(line, 'kyou sora').map((item) => item.value)).toEqual(['kyou', 'sora']);
    expect(rubyReadingForWord(line.words[2], 'sora')).toBe('そら');
  });

  it('uses kana words as anchors and leaves ambiguous spans unresolved', () => {
    const line = createLine('');
    line.words = [createWord('今日'), createWord('も'), createWord('宇宙')];
    expect(suggestLineRomanization(line, 'kyoumosora').map((item) => item.value)).toEqual(['きょう', 'も', 'そら']);
    line.words = [createWord('今日'), createWord('宇宙')];
    const result = suggestLineRomanization(line, 'きょうそら');
    expect(result.map((item) => item.value)).toEqual(['', '']);
    expect(result[0].warning).toMatch(/複|多个词/);
  });

  it('skips kana bases and rejects mixed emoji bases for generated Ruby', () => {
    expect(rubyReadingForWord(createWord('きょう'), 'kyou')).toBeNull();
    expect(() => rubyReadingForWord(createWord('今日🎵'), 'kyou')).toThrow(/混合符号/);
    expect(() => rubyReadingForWord(createWord('宇宙'), 'sor?')).toThrow(/无法/);
  });
});
