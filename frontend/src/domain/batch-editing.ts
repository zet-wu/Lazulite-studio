import { createProjectEditing, emptyBeatCount, type ProjectEditing } from './project-editing';
import type { LyricCommand } from './lyric-commands';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeMs } from './lyric-document';

const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
const cjkSyllable = (text: string) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(text);
const shifted = (value: TimeMs, delta: number): TimeMs => {
  if (value === null) return null;
  const result = value + delta;
  if (!safe(result)) throw new Error('时间偏移超出有效范围；请减小偏移量');
  return result;
};

export function shiftLineTimes(document: LyricDocument, lineIds: string[], deltaMs: number, editing = createProjectEditing()): LyricCommand {
  if (!Number.isSafeInteger(deltaMs)) throw new Error('时间偏移必须是整数毫秒');
  const selected = new Set(lineIds);
  const shiftedLines = document.lines.map((line): LyricLine => {
    if (!selected.has(line.id)) return line;
    return { ...line, beginMs: shifted(line.beginMs, deltaMs), endMs: shifted(line.endMs, deltaMs),
      words: line.words.map((word): LyricWord => ({ ...word, beginMs: shifted(word.beginMs, deltaMs), endMs: shifted(word.endMs, deltaMs),
        rubyUnits: word.rubyUnits.map((unit): RubyUnit => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })),
      })) };
  });
  const lines = shiftedLines.map((line) => {
    if (!editing.endLinks[line.id]) return line;
    const target = shiftedLines.find((item) => item.id === editing.endLinks[line.id])!;
    const endMs = target.beginMs;
    if (endMs === null || line.beginMs !== null && endMs < line.beginMs || line.words.some((word) => word.endMs !== null && word.endMs > endMs)) throw new Error('偏移后链接的行结束时间不能覆盖词块');
    return endMs === line.endMs ? line : { ...line, endMs };
  });
  const romanizationTracks = document.romanizationTracks.map((track) => ({ ...track, contents: track.contents.map((content) =>
    selected.has(content.lineId) && content.kind === 'timed'
      ? { ...content, units: content.units.map((unit) => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })) }
      : content) }));
  const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.map(content => selected.has(content.lineId) && content.kind === 'timed' ? { ...content, units: content.units.map(unit => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })) } : content) }));
  return { type: 'replace-document', document: { ...document, lines, romanizationTracks, translationTracks } };
}

export function smoothWordTimes(document: LyricDocument, lineIds: string[], thresholdMs: number): { command: LyricCommand; count: number } {
  if (!safe(thresholdMs)) throw new Error('平滑阈值必须是非负整数毫秒');
  const selected = new Set(lineIds);
  let count = 0;
  const lines = document.lines.map((line) => {
    if (!selected.has(line.id)) return line;
    const words = line.words.slice();
    for (let index = 0; index < words.length - 1; index++) {
      const left = words[index], right = words[index + 1];
      if (!cjkSyllable(left.text) || !cjkSyllable(right.text)) continue;
      if (left.endMs === null || right.beginMs === null || Math.abs(right.beginMs - left.endMs) > thresholdMs || left.endMs === right.beginMs) continue;
      if (left.rubyUnits.length || right.rubyUnits.length) continue;
      const middle = Math.round((left.endMs + right.beginMs) / 2);
      if (left.beginMs !== null && middle < left.beginMs || right.endMs !== null && middle > right.endMs) continue;
      words[index] = { ...left, endMs: middle };
      words[index + 1] = { ...right, beginMs: middle };
      count++;
    }
    return words.every((word, index) => word === line.words[index]) ? line : { ...line, words };
  });
  return { command: { type: 'replace-document', document: { ...document, lines } }, count };
}

export function syncLineTimes(document: LyricDocument, lineIds: string[]): LyricCommand {
  const selected = new Set(lineIds);
  const commands = document.lines.filter((line) => selected.has(line.id)).flatMap((line) => {
    const starts = line.words.map((word) => word.beginMs).filter((value): value is number => value !== null);
    const ends = line.words.map((word) => word.endMs).filter((value): value is number => value !== null);
    if (!starts.length && !ends.length) return [];
    return [{ type: 'set-line-time' as const, lineId: line.id, beginMs: starts.length ? Math.min(...starts) : line.beginMs, endMs: ends.length ? Math.max(...ends) : line.endMs }];
  });
  return { type: 'batch', commands };
}

export function replaceWords(document: LyricDocument, wordIds: string[], search: string, replacement: string, ignoreCase = false, editing = createProjectEditing()): { command: LyricCommand; count: number } {
  if (!search) throw new Error('查找内容不能为空');
  const selected = new Set(wordIds);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, ignoreCase ? 'giu' : 'gu');
  let count = 0;
  const commands: Extract<LyricCommand, { type: 'edit-word' | 'delete-word' }>[] = [];
  for (const line of document.lines) for (const word of line.words) {
    if (!selected.has(word.id)) continue;
    const matches = word.text.match(pattern);
    if (!matches?.length) continue;
    if (word.rubyUnits.length || word.obscene || emptyBeatCount(editing, word.id)) throw new Error(`词“${word.text}”含注音或附属属性，不能批量替换`);
    const next = word.text.replace(pattern, () => replacement);
    count += matches.length;
    commands.push(next ? { type: 'edit-word', lineId: line.id, wordId: word.id, text: next } : { type: 'delete-word', lineId: line.id, wordId: word.id });
  }
  return { command: { type: 'batch', commands }, count };
}
