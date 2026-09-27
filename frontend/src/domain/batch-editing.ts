import type { LyricCommand } from './lyric-commands';
import type { AlignmentUnit, LyricDocument, LyricLine, LyricWord, RubyUnit, TimeUs } from './lyric-document';

const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
const cjkSyllable = (text: string) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(text);
const shifted = (value: TimeUs, delta: number): TimeUs => {
  if (value === null) return null;
  const result = value + delta;
  if (!safe(result)) throw new Error('时间偏移超出有效范围；请减小偏移量');
  return result;
};

export function shiftLineTimes(document: LyricDocument, lineIds: string[], deltaUs: number): LyricCommand {
  if (!Number.isSafeInteger(deltaUs)) throw new Error('时间偏移必须是整数微秒');
  const selected = new Set(lineIds);
  const shiftedLines = document.lines.map((line): LyricLine => {
    if (!selected.has(line.id)) return line;
    return { ...line, beginUs: shifted(line.beginUs, deltaUs), endUs: shifted(line.endUs, deltaUs),
      endLink: line.endLink ? { ...line.endLink, originalEndUs: shifted(line.endLink.originalEndUs, deltaUs) } : null,
      words: line.words.map((word): LyricWord => ({ ...word, beginUs: shifted(word.beginUs, deltaUs), endUs: shifted(word.endUs, deltaUs),
        rubyUnits: word.rubyUnits.map((unit): RubyUnit => ({ ...unit, beginUs: shifted(unit.beginUs, deltaUs), endUs: shifted(unit.endUs, deltaUs) })),
        alignmentUnits: word.alignmentUnits.map((unit): AlignmentUnit => ({ ...unit, beginUs: shifted(unit.beginUs, deltaUs), endUs: shifted(unit.endUs, deltaUs) })),
      })),
      ...(line.timedRomanizations ? { timedRomanizations: line.timedRomanizations.map((track) => ({ ...track, words: track.words.map((word) => ({ ...word, beginUs: shifted(word.beginUs, deltaUs)!, endUs: shifted(word.endUs, deltaUs)! })) })) } : {}) };
  });
  const lines = shiftedLines.map((line) => {
    if (!line.endLink) return line;
    const target = shiftedLines.find((item) => item.id === line.endLink!.targetLineId)!;
    const endUs = target.beginUs;
    if (endUs === null || line.beginUs !== null && endUs < line.beginUs || line.words.some((word) => word.endUs !== null && word.endUs > endUs)) throw new Error('偏移后链接的行结束时间不能覆盖词块');
    return endUs === line.endUs ? line : { ...line, endUs };
  });
  return { type: 'replace-document', document: { ...document, lines } };
}

export function smoothWordTimes(document: LyricDocument, lineIds: string[], thresholdUs: number): { command: LyricCommand; count: number } {
  if (!safe(thresholdUs)) throw new Error('平滑阈值必须是非负整数微秒');
  const selected = new Set(lineIds);
  let count = 0;
  const lines = document.lines.map((line) => {
    if (!selected.has(line.id)) return line;
    const words = line.words.slice();
    for (let index = 0; index < words.length - 1; index++) {
      const left = words[index], right = words[index + 1];
      if (!cjkSyllable(left.text) || !cjkSyllable(right.text)) continue;
      if (left.endUs === null || right.beginUs === null || Math.abs(right.beginUs - left.endUs) > thresholdUs || left.endUs === right.beginUs) continue;
      if (left.rubyUnits.length || right.rubyUnits.length || left.alignmentUnits.length || right.alignmentUnits.length) continue;
      const middle = Math.round((left.endUs + right.beginUs) / 2);
      if (left.beginUs !== null && middle < left.beginUs || right.endUs !== null && middle > right.endUs) continue;
      words[index] = { ...left, endUs: middle };
      words[index + 1] = { ...right, beginUs: middle };
      count++;
    }
    return words.every((word, index) => word === line.words[index]) ? line : { ...line, words };
  });
  return { command: { type: 'replace-document', document: { ...document, lines } }, count };
}

export function syncLineTimes(document: LyricDocument, lineIds: string[]): LyricCommand {
  const selected = new Set(lineIds);
  const commands = document.lines.filter((line) => selected.has(line.id)).flatMap((line) => {
    const starts = line.words.map((word) => word.beginUs).filter((value): value is number => value !== null);
    const ends = line.words.map((word) => word.endUs).filter((value): value is number => value !== null);
    if (!starts.length && !ends.length) return [];
    return [{ type: 'set-line-time' as const, lineId: line.id, beginUs: starts.length ? Math.min(...starts) : line.beginUs, endUs: ends.length ? Math.max(...ends) : line.endUs }];
  });
  return { type: 'batch', commands };
}

export function replaceWords(document: LyricDocument, wordIds: string[], search: string, replacement: string, ignoreCase = false): { command: LyricCommand; count: number } {
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
    if (word.rubyUnits.length || word.alignmentUnits.length || word.romanization || word.obscene || word.emptyBeat) throw new Error(`词“${word.text}”含注音或附属属性，不能批量替换`);
    const next = word.text.replace(pattern, () => replacement);
    count += matches.length;
    commands.push(next ? { type: 'edit-word', lineId: line.id, wordId: word.id, text: next } : { type: 'delete-word', lineId: line.id, wordId: word.id });
  }
  return { command: { type: 'batch', commands }, count };
}
