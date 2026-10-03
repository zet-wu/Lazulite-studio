import { toHiragana } from 'wanakana';
export type ReadingRange = { line_id: string; base_start: number; base_end: number; base: string; reading: string };
import { lineText, rubyReading, type LyricDocument, type LyricWord } from './lyric-document';
import type { LyricCommand } from './lyric-commands';
import { makeRubyUnits, splitReadingMora } from './ruby-editing';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const han = /[\p{Script=Han}々〆]/u;
const length = (text: string) => Array.from(text).length;
const slice = (text: string, start: number, end: number) => Array.from(text).slice(start, end).join('');
export type ReadingBlock = { key: string; wordId: string; start: number; end: number; text: string; reading: string; editable: boolean; existing: boolean };
export type ReadingRow = { lineId: string; background: boolean; blocks: ReadingBlock[] };

function runs(text: string) {
  const result: Array<{ text: string; start: number; end: number; kanji: boolean }> = [];
  let offset = 0;
  for (const { segment } of segmenter.segment(text)) {
    const end = offset + length(segment), kanji = han.test(segment), last = result.at(-1);
    if (last?.kanji === kanji) { last.text += segment; last.end = end; }
    else result.push({ text: segment, start: offset, end, kanji });
    offset = end;
  }
  return result;
}

// Only accept a unique kana-anchor decomposition; never split a reading by character count.
function mapReading(text: string, reading: string): string[] | null {
  const parts = runs(text), kana = Array.from(toHiragana(reading).normalize('NFC'));
  if (!reading) return null;
  if (parts.length === 1 && parts[0].kanji) return [reading];
  const solutions: string[][] = [];
  const failed = new Set<string>();
  const visit = (index: number, offset: number, values: string[]) => {
    if (solutions.length > 1) return;
    if (index === parts.length) { if (offset === kana.length) solutions.push(values); return; }
    const key = `${index}:${offset}`;
    if (failed.has(key)) return;
    const before = solutions.length;
    const part = parts[index];
    if (!part.kanji) {
      const anchor = Array.from(toHiragana(part.text).normalize('NFC'));
      if (anchor.every((c, i) => kana[offset + i] === c)) visit(index + 1, offset + anchor.length, [...values, '']);
    } else {
      if (offset >= kana.length) return;
      for (let end = index === parts.length - 1 ? kana.length : offset + 1; end <= kana.length && solutions.length < 2; end++) visit(index + 1, end, [...values, kana.slice(offset, end).join('')]);
    }
    if (solutions.length === before) failed.add(key);
  };
  if (reading) visit(0, 0, []);
  return solutions.length === 1 ? solutions[0] : null;
}

export function proposeJapaneseRuby(source: LyricDocument, ids: string[], ranges: ReadingRange[]): ReadingRow[] {
  const selected = new Set(ids), byLine = new Map<string, ReadingRange[]>();
  for (const range of ranges) {
    const entries = byLine.get(range.line_id) ?? []; entries.push(range); byLine.set(range.line_id, entries);
  }
  return source.lines.filter(line => selected.has(line.id)).map(line => {
    const text = lineText(line), entries = byLine.get(line.id) ?? [];
    let previous = 0;
    for (const range of entries) {
      if (!Number.isInteger(range.base_start) || !Number.isInteger(range.base_end) || range.base_start < previous || range.base_end <= range.base_start || range.base_end > length(text) || slice(text, range.base_start, range.base_end) !== range.base) throw new Error('读音分析范围与原文不符');
      previous = range.base_end;
    }
    let offset = 0;
    const blocks = line.words.flatMap(word => {
      const start = offset; offset += length(word.text);
      const block = (a: number, b: number, reading: string, existing = false): ReadingBlock => ({ key: `${word.id}:${a}:${b}`, wordId: word.id, start: a, end: b, text: slice(word.text, a, b), reading, existing, editable: existing || han.test(slice(word.text, a, b)) });
      if (word.rubyUnits.length) return [block(0, length(word.text), rubyReading(word), true)];
      const boundaries = new Set([0]); let cp = 0;
      for (const item of segmenter.segment(word.text)) { cp += length(item.segment); boundaries.add(cp); }
      const candidates = entries.filter(r => r.base_start >= start && r.base_end <= offset && boundaries.has(r.base_start - start) && boundaries.has(r.base_end - start));
      const result: ReadingBlock[] = []; let cursor = 0;
      const append = (a: number, b: number, reading: string) => {
        const value = slice(word.text, a, b), parts = runs(value), mapped = mapReading(value, reading);
        parts.forEach((part, index) => result.push(block(a + part.start, a + part.end, mapped?.[index] ?? '')));
      };
      for (const r of candidates) { const a = r.base_start - start, b = r.base_end - start; if (a > cursor) append(cursor, a, ''); append(a, b, r.reading); cursor = b; }
      if (cursor < length(word.text)) append(cursor, length(word.text), '');
      return result;
    });
    return { lineId: line.id, background: !!line.backgroundOf, blocks };
  });
}

export function hasJapaneseRubyChanges(rows: ReadingRow[], source: LyricDocument): boolean {
  const words = new Map(source.lines.flatMap(line => line.words.map(word => [word.id, word] as const)));
  return rows.some(row => row.blocks.some(b => b.editable && b.reading.trim() && (!b.existing || b.reading !== rubyReading(words.get(b.wordId)!))));
}

export function japaneseRubyCommand(current: LyricDocument, source: LyricDocument, rows: ReadingRow[]): LyricCommand {
  if (current !== source) throw new Error('源文档已变化，请重新打开生成');
  if (!hasJapaneseRubyChanges(rows, source)) throw new Error('没有可应用的注音修改');
  const rowMap = new Map(rows.map(row => [row.lineId, row]));
  const lines = source.lines.map(line => {
    const row = rowMap.get(line.id); if (!row) return line;
    const groups = new Map<string, ReadingBlock[]>();
    for (const b of row.blocks) { const group = groups.get(b.wordId) ?? []; group.push(b); groups.set(b.wordId, group); }
    const words = line.words.flatMap(word => {
      const blocks = groups.get(word.id);
      if (!blocks || blocks.map(b => b.text).join('') !== word.text) throw new Error('提案正文结构不完整');
      let cursor = 0;
      for (const b of blocks) { if (b.start !== cursor || b.end <= b.start || slice(word.text, b.start, b.end) !== b.text) throw new Error('提案正文范围不符'); cursor = b.end; }
      if (word.rubyUnits.length) {
        if (blocks.length !== 1 || !blocks[0].existing) throw new Error('已有注音结构不符');
        const reading = blocks[0].reading;
        if (!reading.trim() || reading === rubyReading(word)) return [word];
        const starts = word.rubyUnits.flatMap(u => u.beginMs === null ? [] : [u.beginMs]), ends = word.rubyUnits.flatMap(u => u.endMs === null ? [] : [u.endMs]);
        return [{ ...word, rubyUnits: makeRubyUnits({ ...word, beginMs: starts.length ? Math.min(...starts) : null, endMs: ends.length ? Math.max(...ends) : null }, splitReadingMora(reading)) }];
      }
      const accepted = blocks.filter(b => b.editable && b.reading.trim());
      if (!accepted.length) return [word];
      const cuts = [...new Set([0, length(word.text), ...accepted.flatMap(b => [b.start, b.end])])].sort((a,b) => a-b);
      const boundary = (at: number) => at === 0 ? word.beginMs : at === length(word.text) ? word.endMs : word.beginMs === null || word.endMs === null ? null : word.beginMs + Math.round((word.endMs-word.beginMs)*at/length(word.text));
      return cuts.slice(0,-1).map((a,index): LyricWord => {
        const b = cuts[index+1], reading = accepted.find(item => item.start === a && item.end === b)?.reading;
        const part = { ...word, id: index ? crypto.randomUUID() : word.id, text: slice(word.text,a,b), beginMs: boundary(a), endMs: boundary(b), emptyBeat: index ? 0 : word.emptyBeat };
        return reading ? { ...part, rubyUnits: makeRubyUnits(part, splitReadingMora(reading)) } : part;
      });
    });
    return { ...line, words };
  });
  return { type: 'replace-document', document: { ...source, lines } };
}
