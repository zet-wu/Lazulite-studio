import { timeEnvelope } from './lyric-commands';
import type { LyricLine, LyricWord, RubyUnit } from './lyric-document';

export const hasPronounceableText = (text: string) => /[\p{L}\p{N}]/u.test(text);
export type ReadingLeaf = { wordIndex: number; rubyIndex: number | null; text: string; value: LyricWord | RubyUnit };

/** Preserve whitespace/punctuation leaves so edits never bridge across them. */
export function readingLeaves(line: LyricLine): ReadingLeaf[] {
  return line.words.flatMap((word, wordIndex) => word.rubyUnits.length
    ? word.rubyUnits.map((value, rubyIndex) => ({ wordIndex, rubyIndex, text: value.reading, value }))
    : [{ wordIndex, rubyIndex: null, text: word.text, value: word }] as ReadingLeaf[]);
}

/** Close one internal boundary atomically, recomputing changed ruby parents. */
export function closeReadingBoundary(line: LyricLine, left: ReadingLeaf, right: ReadingLeaf): LyricLine {
  const value = (leaf: ReadingLeaf) => leaf.rubyIndex === null ? line.words[leaf.wordIndex] : line.words[leaf.wordIndex].rubyUnits[leaf.rubyIndex];
  const a = value(left), b = value(right);
  if (a.endMs === null || b.beginMs === null || a.endMs === b.beginMs) return line;
  const middle = Math.round((a.endMs + b.beginMs) / 2);
  if (a.beginMs !== null && middle < a.beginMs || b.endMs !== null && middle > b.endMs) return line;
  const words = line.words.slice();
  for (const [leaf, side] of [[left, 'endMs'], [right, 'beginMs']] as const) {
    const word = words[leaf.wordIndex];
    if (leaf.rubyIndex === null) words[leaf.wordIndex] = { ...word, [side]: middle };
    else {
      const rubyUnits = word.rubyUnits.map((unit, index) => index === leaf.rubyIndex ? { ...unit, [side]: middle } : unit);
      const span = timeEnvelope(rubyUnits);
      words[leaf.wordIndex] = { ...word, rubyUnits, beginMs: span.beginMs ?? word.beginMs, endMs: span.endMs ?? word.endMs };
    }
  }
  const span = timeEnvelope([line, ...words]);
  return { ...line, words, beginMs: line.beginMs === null ? null : span.beginMs, endMs: line.endMs === null ? null : span.endMs };
}
