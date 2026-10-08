import type { LyricDocument } from '../domain/lyric-document';

/** Parser provenance is transient; it never adds inherited clocks to the document. */
export function lyricCapabilities(document: LyricDocument, lineTimedWords: ReadonlySet<string> = new Set()): string[] {
  const timed = (item: { beginMs: number | null; endMs: number | null }) => item.beginMs !== null || item.endMs !== null;
  const lines = document.lines.filter(line => line.words.some(word => word.text.trim()));
  const words = lines.flatMap(line => line.words).filter(word => word.text.trim());
  const fine = words.some(word => !lineTimedWords.has(word.id) && timed(word) || word.rubyUnits.some(timed));
  const hasTime = fine || lines.some(timed);
  const partial = fine ? words.some(word => {
    if (word.rubyUnits.length) return word.rubyUnits.some(unit => !timed(unit));
    return lineTimedWords.has(word.id) || !timed(word);
  }) : hasTime && lines.some(line => !timed(line));
  const badges = [fine ? '逐词' : hasTime ? '逐行' : '无时间'];
  if (partial) badges.push('部分定时');
  if (document.translationTracks.some(track => track.contents.length)) badges.push('翻译');
  if (document.romanizationTracks.some(track => track.contents.length)) badges.push('音译');
  if (words.some(word => word.rubyUnits.length)) badges.push('注音');
  return badges;
}
