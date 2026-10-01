import type { LyricWord } from './lyric-document';
import { readingFromRomanization } from './ruby-editing';

const meaningful = /[\p{Letter}\p{Number}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const kanaOnly = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/** Romanization stays in document tracks; this only converts an explicit 注音 proposal. */
export function rubyReadingForWord(word: LyricWord, romanization: string): string | null {
  const text = word.text.trim();
  if (!meaningful.test(text) || kanaOnly.test(text)) return null;
  if (/[^\p{Letter}\p{Number}\p{Script=Han}々〆ヶ]/u.test(text)) throw new Error(`词「${word.text}」含混合符号，请手动添加 注音`);
  return readingFromRomanization(romanization);
}
