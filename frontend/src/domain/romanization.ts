import { toHiragana, toKana } from 'wanakana';
import type { LyricLine, LyricWord } from './lyric-document';
import { isKanaText, readingFromRomanization } from './ruby-editing';

export type RomanizationSuggestion = { word: LyricWord; value: string; warning: string | null };

const meaningful = /[\p{Letter}\p{Number}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const kanaOnly = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

function baseKana(word: LyricWord): string | null {
  const text = word.text.trim();
  return kanaOnly.test(text) ? toHiragana(text) : null;
}

/** Only exact token counts or unambiguous kana anchors are distributed automatically. */
export function suggestLineRomanization(line: LyricLine, source = line.romanizations[0]?.text ?? ''): RomanizationSuggestion[] {
  const words = line.words.filter((word) => meaningful.test(word.text));
  const result = words.map((word) => ({ word, value: '', warning: null as string | null }));
  const trimmed = source.trim();
  if (!trimmed) return result.map((item) => ({ ...item, warning: '此行没有音译' }));
  const tokens = trimmed.split(/\s+/u);
  if (tokens.length === words.length) return result.map((item, index) => ({ ...item, value: tokens[index] }));

  const kana = toHiragana(toKana(trimmed.replace(/\s+/gu, '')));
  if (!isKanaText(kana)) return result.map((item) => ({ ...item, warning: '音译无法转换成连续假名；请逐词填写' }));
  const anchors: Array<{ index: number; begin: number; end: number }> = [];
  let cursor = 0;
  for (const [index, word] of words.entries()) {
    const reading = baseKana(word);
    if (!reading) continue;
    const begin = kana.indexOf(reading, cursor);
    if (begin < 0) return result.map((item) => ({ ...item, warning: `未找到假名锚点「${word.text.trim()}」` }));
    anchors.push({ index, begin, end: begin + reading.length });
    cursor = begin + reading.length;
  }
  let lastIndex = -1;
  let lastEnd = 0;
  for (const anchor of [...anchors, { index: words.length, begin: kana.length, end: kana.length }]) {
    const gap = kana.slice(lastEnd, anchor.begin);
    const count = anchor.index - lastIndex - 1;
    if (count === 1 && gap) result[lastIndex + 1].value = gap;
    else if (count > 0) for (let index = lastIndex + 1; index < anchor.index; index++) result[index].warning = gap ? '多个词共用一段读音，请逐词分配' : '没有可分配的读音';
    if (anchor.index < words.length) result[anchor.index].value = kana.slice(anchor.begin, anchor.end);
    lastIndex = anchor.index;
    lastEnd = anchor.end;
  }
  return result;
}

export function rubyReadingForWord(word: LyricWord, romanization: string): string | null {
  const text = word.text.trim();
  if (!meaningful.test(text) || baseKana(word)) return null;
  if (/[^\p{Letter}\p{Number}\p{Script=Han}々〆ヶ]/u.test(text)) throw new Error(`词「${word.text}」含混合符号，请手动添加 Ruby`);
  return readingFromRomanization(romanization);
}
