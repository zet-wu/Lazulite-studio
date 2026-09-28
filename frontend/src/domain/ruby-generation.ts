import { toHiragana, toKatakana } from 'wanakana';
import type { LyricCommand } from './lyric-commands';
import type { LyricDocument, LyricLine, LyricWord, RomanizationContent, RubyUnit, TimeUs } from './lyric-document';

export type RubyOutput = 'roman' | 'hiragana' | 'katakana';
export type RubySourceRow = {
  key: string; lineId: string; trackId: string; contentId: string; unitId: string | null;
  sourceText: string; beginUs: TimeUs; endUs: TimeUs;
  candidates: string[]; suggestedWordId: string | null; defaultWordId: string | null;
};
export type RubyProposalRow = RubySourceRow & { wordId: string | null; reading: string | null; conversionIssue: string | null };

export const RUBY_OVERLAP_TOLERANCE_US = 10_000;

const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const sourceReading = (text: string) => text.replace(/\s+/gu, '');
const convert = (value: string, output: RubyOutput) => output === 'roman' ? value : output === 'hiragana' ? toHiragana(value) : toKatakana(value);
const overlap = (begin: number, end: number, word: LyricWord) => word.beginUs === null || word.endUs === null ? 0
  : Math.max(0, Math.min(end, word.endUs) - Math.max(begin, word.beginUs));

export function rubySourceRows(document: LyricDocument, trackId: string, contentIds: string[]): RubySourceRow[] {
  const track = document.romanizationTracks.find((item) => item.id === trackId);
  if (!track) throw new Error('音译轨道不存在');
  const requested = new Set(contentIds);
  if (!requested.size || contentIds.some((id) => !track.contents.some((content) => content.id === id))) throw new Error('请选择当前轨道中的音译内容');
  return track.contents.filter((content) => requested.has(content.id)).flatMap((content: RomanizationContent) => {
    const line = document.lines.find((item) => item.id === content.lineId && !item.backgroundOf);
    if (!line) throw new Error('音译主行已不存在');
    const units = content.kind === 'plain'
      ? [{ id: null, text: content.text, beginUs: null, endUs: null }]
      : content.units.map((unit) => ({ ...unit }));
    return units.map((unit) => {
      const ranked = unit.beginUs !== null && unit.endUs !== null && unit.beginUs < unit.endUs
        ? line.words.map((word) => ({ id: word.id, amount: overlap(unit.beginUs!, unit.endUs!, word) })).filter((item) => item.amount > 0).sort((left, right) => right.amount - left.amount)
        : [];
      const substantial = ranked[0]?.amount > RUBY_OVERLAP_TOLERANCE_US;
      const candidates = substantial ? ranked.filter(item => item.amount > RUBY_OVERLAP_TOLERANCE_US) : ranked;
      return { key: `${content.id}:${unit.id ?? 'plain'}`, lineId: line.id, trackId, contentId: content.id, unitId: unit.id,
        sourceText: unit.text, beginUs: unit.beginUs, endUs: unit.endUs,
        candidates: candidates.map((item) => item.id), suggestedWordId: candidates[0]?.id ?? null, defaultWordId: substantial && candidates.length === 1 ? candidates[0].id : null };
    });
  });
}

export function proposeRuby(rows: RubySourceRow[], output: RubyOutput, assignments: Record<string, string | null> = {}): RubyProposalRow[] {
  const proposed: RubyProposalRow[] = rows.map((row) => ({ ...row,
    wordId: Object.hasOwn(assignments, row.key) ? assignments[row.key] : row.defaultWordId,
    reading: null, conversionIssue: null }));
  const groups = new Map<string, RubyProposalRow[]>();
  for (const row of proposed) if (row.wordId) {
    const key = `${row.lineId}:${row.wordId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const source = group.map((row) => sourceReading(row.sourceText));
    const joined = convert(source.join(''), output);
    const pieces = source.map((value) => convert(value, output));
    const valid = source.every(Boolean) && pieces.join('') === joined && (output === 'roman' || pieces.every((part) => kana.test(part)));
    for (let index = 0; index < group.length; index++) {
      group[index].reading = valid ? pieces[index] : null;
      group[index].conversionIssue = valid ? null : `整组转换：${joined || '空'}；请手动确认每个 Ruby 的拆分`;
    }
  }
  return proposed;
}

/** Compare the entire assigned group before filtering skipped rows; manual readings stay explicit. */
export function defaultRubySkips(document: LyricDocument, rows: RubyProposalRow[], output: RubyOutput, readings: Record<string, string>): Set<string> {
  const skipped = new Set<string>();
  if (output === 'roman') return skipped;
  const targetKana = output === 'hiragana' ? /^[\p{Script=Hiragana}ー]+$/u : /^[\p{Script=Katakana}ー]+$/u;
  const words = new Map<string, LyricWord>(document.lines.flatMap(line => line.words.map(word => [`${line.id}:${word.id}`, word] as const)));
  const groups = new Map<string, RubyProposalRow[]>();
  for (const row of rows) if (row.wordId) {
    const key = `${row.lineId}:${row.wordId}`;
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  for (const [key, group] of groups) {
    const text = words.get(key)!.text.normalize('NFC');
    if (!targetKana.test(text) || group.some(row => row.conversionIssue || !row.reading)) continue;
    const joined = group.map(row => readings[row.key] ?? row.reading).join('').normalize('NFC');
    if (joined === text) for (const row of group) if (!Object.hasOwn(readings, row.key)) skipped.add(row.key);
  }
  return skipped;
}

type Envelope = { beginUs: TimeUs; endUs: TimeUs };
const envelope = (base: Envelope, begins: TimeUs[], ends: TimeUs[]): Envelope => {
  const starts = [base.beginUs, ...begins].filter((value): value is number => value !== null);
  const finishes = [base.endUs, ...ends].filter((value): value is number => value !== null);
  return { beginUs: starts.length ? Math.min(...starts) : null, endUs: finishes.length ? Math.max(...finishes) : null };
};

export type RubyGenerationPreview = { command: LyricCommand; extensions: Array<{ kind: 'line' | 'word'; lineId: string; wordId?: string; before: Envelope; after: Envelope }> };

export function rubyGenerationCommand(document: LyricDocument, sourceDocument: LyricDocument, rows: RubyProposalRow[], readings: Record<string, string>, skipped: Set<string>, overwriteWordIds: Set<string>, allowExtension: boolean): RubyGenerationPreview {
  if (document !== sourceDocument) throw new Error('文档已变化，请重新生成提案');
  const byWord = new Map<string, RubyProposalRow[]>();
  for (const row of rows) {
    if (skipped.has(row.key)) continue;
    if (!row.wordId) throw new Error(`音译「${row.sourceText}」尚未指定目标词`);
    const reading = readings[row.key] ?? row.reading;
    if (!reading?.trim()) throw new Error(`音译「${row.sourceText}」尚未确认 Ruby 读音`);
    const line = document.lines.find((item) => item.id === row.lineId);
    if (!line?.words.some((word) => word.id === row.wordId)) throw new Error('目标词已变化，请重新生成提案');
    const key = `${row.lineId}:${row.wordId}`;
    byWord.set(key, [...(byWord.get(key) ?? []), { ...row, reading: reading.trim() }]);
  }
  if (!byWord.size) throw new Error('没有可应用的 Ruby');
  const commands: Extract<LyricCommand, { type: 'set-line-time' | 'set-word-time' | 'set-ruby-units' }>[] = [];
  const extensions: RubyGenerationPreview['extensions'] = [];
  for (const line of document.lines) {
    const groups = line.words.map((word) => ({ word, rows: byWord.get(`${line.id}:${word.id}`) ?? [] })).filter((group) => group.rows.length);
    if (!groups.length) continue;
    const proposedWords = groups.map(({ word, rows }) => {
      if (word.rubyUnits.length && !overwriteWordIds.has(word.id)) throw new Error(`词「${word.text}」已有 Ruby，请显式选择覆盖`);
      const units: RubyUnit[] = rows.map((row) => ({ id: crypto.randomUUID(), reading: row.reading!, beginUs: row.beginUs, endUs: row.endUs }));
      const next = envelope(word, [...word.rubyUnits.map((unit) => unit.beginUs), ...units.map((unit) => unit.beginUs)], [...word.rubyUnits.map((unit) => unit.endUs), ...units.map((unit) => unit.endUs)]);
      if (next.beginUs !== word.beginUs || next.endUs !== word.endUs) extensions.push({ kind: 'word', lineId: line.id, wordId: word.id, before: { beginUs: word.beginUs, endUs: word.endUs }, after: next });
      return { word, units, next };
    });
    const lineNext = envelope(line,
      [...line.words.map((word) => word.beginUs), ...proposedWords.map((item) => item.next.beginUs)],
      [...line.words.map((word) => word.endUs), ...proposedWords.map((item) => item.next.endUs)]);
    if (lineNext.beginUs !== line.beginUs || lineNext.endUs !== line.endUs) {
      if (line.endLink || document.lines.some((item) => item.endLink?.targetLineId === line.id)) throw new Error('行尾链接会受时间扩展影响，请先处理链接');
      extensions.push({ kind: 'line', lineId: line.id, before: { beginUs: line.beginUs, endUs: line.endUs }, after: lineNext });
      commands.push({ type: 'set-line-time', lineId: line.id, ...lineNext });
    }
    for (const { word, units, next } of proposedWords) {
      if (next.beginUs !== word.beginUs || next.endUs !== word.endUs) commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, ...next });
      commands.push({ type: 'set-ruby-units', lineId: line.id, wordId: word.id, units, overwrite: overwriteWordIds.has(word.id) });
    }
  }
  if (extensions.length && !allowExtension) throw new Error('请确认词/行时间包络扩展');
  return { command: { type: 'batch', commands }, extensions };
}
