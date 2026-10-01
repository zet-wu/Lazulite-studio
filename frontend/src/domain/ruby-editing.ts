import { toKana } from 'wanakana';
import type { LyricWord, RubyUnit, TimeMs } from './lyric-document';

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const smallKana = /^[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]$/u;
const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

export function isKanaText(text: string): boolean {
  return kana.test(text.trim());
}

export function readingFromRomanization(value: string): string {
  const source = value.replace(/\s+/gu, '');
  if (!source) throw new Error('逐词音译为空');
  const reading = toKana(source);
  if (!kana.test(reading)) throw new Error(`无法把音译转换成假名：${value}`);
  return reading;
}

export function splitReadingMora(reading: string): string[] {
  const parts: string[] = [];
  for (const item of graphemeSegmenter.segment(reading)) {
    const char = item.segment;
    if (smallKana.test(char) && parts.length) parts[parts.length - 1] += char;
    else parts.push(char);
  }
  return parts;
}

function boundary(begin: TimeMs, end: TimeMs, position: number, total: number): TimeMs {
  if (position === 0) return begin;
  if (position === total) return end;
  if (begin === null || end === null) return null;
  return begin + Math.round((end - begin) * position / total);
}

export function distributeRubyTime(word: LyricWord, units: RubyUnit[]): RubyUnit[] {
  if (!units.length || units.some((unit) => !unit.reading)) throw new Error('读音单元不能为空');
  const weights = units.map((unit) => Math.max(1, splitReadingMora(unit.reading).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  return units.map((unit, index) => {
    const beginMs = boundary(word.beginMs, word.endMs, elapsed, total);
    elapsed += weights[index];
    const endMs = boundary(word.beginMs, word.endMs, elapsed, total);
    return { ...unit, beginMs, endMs };
  });
}

export function makeRubyUnits(word: LyricWord, readings: string[]): RubyUnit[] {
  if (!readings.length || readings.some((reading) => !reading)) throw new Error('读音单元不能为空');
  const units = readings.map((reading) => ({ id: crypto.randomUUID(), reading, beginMs: null, endMs: null }));
  return distributeRubyTime(word, units);
}
