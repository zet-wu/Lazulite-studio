import { toHiragana, toKatakana } from 'wanakana';
import type { LyricCommand } from './lyric-commands';
import type { LyricDocument, LyricWord, RomanizationContent, RubyUnit, TimeMs } from './lyric-document';

export type RubyOutput = 'roman' | 'hiragana' | 'katakana';
export type RubySourceRow = {
  key: string; lineId: string; trackId: string; contentId: string; unitId: string | null;
  sourceText: string; beginMs: TimeMs; endMs: TimeMs;
  candidates: string[]; suggestedWordId: string | null; defaultWordId: string | null;
};
export type RubyProposalRow = RubySourceRow & { wordId: string | null; reading: string | null; conversionIssue: string | null };

export const RUBY_OVERLAP_TOLERANCE_MS = 50;

const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
// Explicit non-reading punctuation; preserve apostrophes, hyphens and unknown symbols.
const punctuationOnly = /^[,，、.。!！?？:：;；()（）\[\]［］{}｛｝「」『』【】〈〉《》“”"…⋯]+$/u;
const sourceReading = (text: string) => text.replace(/\s+/gu, '');
const convert = (value: string, output: RubyOutput) => output === 'roman' ? value : output === 'hiragana' ? toHiragana(value) : toKatakana(value);
const overlap = (begin: number, end: number, word: LyricWord) => word.beginMs === null || word.endMs === null ? 0
  : Math.max(0, Math.min(end, word.endMs) - Math.max(begin, word.beginMs));

export function rubySourceRows(document: LyricDocument, trackId: string, contentIds: string[]): RubySourceRow[] {
  const track = document.romanizationTracks.find((item) => item.id === trackId);
  if (!track) throw new Error('音译轨道不存在');
  const requested = new Set(contentIds);
  if (!requested.size || contentIds.some((id) => !track.contents.some((content) => content.id === id))) throw new Error('请选择当前轨道中的音译内容');
  return track.contents.filter((content) => requested.has(content.id)).flatMap((content: RomanizationContent) => {
    const line = document.lines.find((item) => item.id === content.lineId);
    if (!line) throw new Error('音译所属行已不存在');
    const units = content.kind === 'plain'
      ? [{ id: null, text: content.text, beginMs: null, endMs: null }]
      : content.units.map((unit) => ({ ...unit }));
    return units.filter((unit) => sourceReading(unit.text) && !punctuationOnly.test(unit.text.trim())).map((unit) => {
      const ranked = unit.beginMs !== null && unit.endMs !== null && unit.beginMs < unit.endMs
        ? line.words.map((word) => ({ id: word.id, amount: overlap(unit.beginMs!, unit.endMs!, word) })).filter((item) => item.amount > 0).sort((left, right) => right.amount - left.amount)
        : [];
      const substantial = ranked[0]?.amount > RUBY_OVERLAP_TOLERANCE_MS;
      const candidates = substantial ? ranked.filter(item => item.amount > RUBY_OVERLAP_TOLERANCE_MS) : ranked;
      return { key: `${content.id}:${unit.id ?? 'plain'}`, lineId: line.id, trackId, contentId: content.id, unitId: unit.id,
        sourceText: unit.text, beginMs: unit.beginMs, endMs: unit.endMs,
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
      group[index].conversionIssue = valid ? null : `整组转换：${joined || '空'}；请手动确认每个 注音 的拆分`;
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

type Envelope = { beginMs: TimeMs; endMs: TimeMs };
const envelope = (base: Envelope, begins: TimeMs[], ends: TimeMs[]): Envelope => {
  const starts = [base.beginMs, ...begins].filter((value): value is number => value !== null);
  const finishes = [base.endMs, ...ends].filter((value): value is number => value !== null);
  return { beginMs: starts.length ? Math.min(...starts) : null, endMs: finishes.length ? Math.max(...finishes) : null };
};

export type RubyIssueKind = 'target' | 'reading' | 'overwrite' | 'link' | 'kana-difference';
export type RubyIssue = {
  id: string; kind: RubyIssueKind; severity: 'error' | 'warning';
  lineId: string; rowKey: string; rowKeys: string[]; wordId: string | null;
  position: number; order: number; message: string;
};
const issueOrder: Record<RubyIssueKind, number> = { target: 0, reading: 1, overwrite: 2, link: 3, 'kana-difference': 4 };
const effectiveReading = (row: RubyProposalRow, readings: Record<string, string>) => (readings[row.key] ?? row.reading ?? '').trim();
const wordEnvelope = (word: LyricWord, rows: RubyProposalRow[]) => envelope(word,
  [...word.rubyUnits.map(unit => unit.beginMs), ...rows.map(row => row.beginMs)],
  [...word.rubyUnits.map(unit => unit.endMs), ...rows.map(row => row.endMs)]);
const comparableKana = (text: string) => toHiragana(text.normalize('NFC')).normalize('NFC');

/** Shared by preflight and submission; all determinable errors are collected together. */
export function rubyGenerationIssues(document: LyricDocument, rows: RubyProposalRow[], readings: Record<string, string>,
  skipped: Set<string>, overwrite: Set<string>, output: RubyOutput = 'roman'): RubyIssue[] {
  const issues: RubyIssue[] = [];
  const positions = new Map(rows.map((row, index) => [row.key, index]));
  const add = (kind: RubyIssueKind, group: RubyProposalRow[], message: string) => {
    const active = group.filter(row => !skipped.has(row.key));
    if (!active.length) return;
    const row = active[0];
    issues.push({ id: JSON.stringify([kind, row.lineId, kind === 'target' || kind === 'reading' ? row.key : row.wordId]),
      kind, severity: kind === 'kana-difference' ? 'warning' : 'error', lineId: row.lineId, rowKey: row.key,
      rowKeys: active.map(item => item.key), wordId: row.wordId, position: positions.get(row.key)!, order: issueOrder[kind], message });
  };
  const groups = new Map<string, RubyProposalRow[]>();
  for (const row of rows) {
    if (row.wordId) {
      const key = JSON.stringify([row.lineId, row.wordId]);
      const group = groups.get(key);
      if (group) group.push(row); else groups.set(key, [row]);
    }
    if (skipped.has(row.key)) continue;
    const word = document.lines.find(line => line.id === row.lineId)?.words.find(word => word.id === row.wordId);
    if (!word) add('target', [row], '尚未指定有效目标词');
    if (!effectiveReading(row, readings)) add('reading', [row], row.conversionIssue ?? '尚未确认 注音 读音');
  }
  for (const group of groups.values()) {
    const row = group[0];
    const word = document.lines.find(line => line.id === row.lineId)?.words.find(word => word.id === row.wordId);
    if (!word) continue;
    if (word.rubyUnits.length && !overwrite.has(word.id)) add('overwrite', group, '已有 注音，请显式选择覆盖');
    const text = word.text.normalize('NFC');
    const values = group.map(row => effectiveReading(row, readings).normalize('NFC'));
    if (output !== 'roman' && kana.test(text) && values.every(value => kana.test(value))
      && comparableKana(values.join('')) !== comparableKana(text)) {
      add('kana-difference', group, '注音与假名正文读音不同，请核对');
    }
  }
  for (const line of document.lines) {
    const active = rows.filter(row => row.lineId === line.id && row.wordId && !skipped.has(row.key));
    if (!active.length) continue;
    const nextWords = line.words.map(word => wordEnvelope(word, active.filter(row => row.wordId === word.id)));
    const next = envelope(line, nextWords.map(word => word.beginMs), nextWords.map(word => word.endMs));
    if ((next.beginMs !== line.beginMs || next.endMs !== line.endMs)
      && (line.endLink || document.lines.some(item => item.endLink?.targetLineId === line.id))) {
      add('link', active, '行尾链接会受时间扩展影响，请先处理链接');
    }
  }
  return issues.sort((a, b) => a.position - b.position || a.order - b.order);
}

/** Keep a stable identity plus the former position when a corrected issue disappears. */
export function nextRubyIssue(issues: RubyIssue[], current: RubyIssue | null): RubyIssue | null {
  if (!issues.length) return null;
  if (!current) return issues[0];
  const index = issues.findIndex(issue => issue.id === current.id);
  if (index >= 0) return issues[(index + 1) % issues.length];
  return issues.find(issue => issue.position > current.position || issue.position === current.position && issue.order > current.order) ?? issues[0];
}

export function rubyGenerationCommand(document: LyricDocument, sourceDocument: LyricDocument, rows: RubyProposalRow[], readings: Record<string, string>, skipped: Set<string>, overwriteWordIds: Set<string>): LyricCommand {
  if (document !== sourceDocument) throw new Error('文档已变化，请重新生成提案');
  const blocking = rubyGenerationIssues(document, rows, readings, skipped, overwriteWordIds).find(issue => issue.severity === 'error');
  if (blocking) throw new Error(blocking.message);
  const byWord = new Map<string, RubyProposalRow[]>();
  for (const row of rows) {
    if (skipped.has(row.key)) continue;
    const reading = readings[row.key] ?? row.reading;
    const key = `${row.lineId}:${row.wordId}`;
    byWord.set(key, [...(byWord.get(key) ?? []), { ...row, reading: reading!.trim() }]);
  }
  if (!byWord.size) throw new Error('没有可应用的 注音');
  const commands: Extract<LyricCommand, { type: 'set-line-time' | 'set-word-time' | 'set-ruby-units' }>[] = [];
  for (const line of document.lines) {
    const groups = line.words.map((word) => ({ word, rows: byWord.get(`${line.id}:${word.id}`) ?? [] })).filter((group) => group.rows.length);
    if (!groups.length) continue;
    const proposedWords = groups.map(({ word, rows }) => {
      const units: RubyUnit[] = rows.map((row) => ({ id: crypto.randomUUID(), reading: row.reading!, beginMs: row.beginMs, endMs: row.endMs }));
      const next = wordEnvelope(word, rows);
      return { word, units, next };
    });
    const lineNext = envelope(line,
      [...line.words.map((word) => word.beginMs), ...proposedWords.map((item) => item.next.beginMs)],
      [...line.words.map((word) => word.endMs), ...proposedWords.map((item) => item.next.endMs)]);
    if (lineNext.beginMs !== line.beginMs || lineNext.endMs !== line.endMs) {
      commands.push({ type: 'set-line-time', lineId: line.id, ...lineNext });
    }
    for (const { word, units, next } of proposedWords) {
      if (next.beginMs !== word.beginMs || next.endMs !== word.endMs) commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, ...next });
      commands.push({ type: 'set-ruby-units', lineId: line.id, wordId: word.id, units, overwrite: overwriteWordIds.has(word.id) });
    }
  }
  return { type: 'batch', commands };
}
