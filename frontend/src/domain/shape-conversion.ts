import { lineText, type LyricDocument } from './lyric-document';
import type { LyricCommand } from './lyric-commands';

export const shapeTargets = { simplified: '简体中文', taiwan: '台湾正体', hongkong: '香港繁体', japanese: '日文新字体' } as const;
export type ShapeTarget = keyof typeof shapeTargets;
export type ShapeStatus = 'known' | 'ambiguous' | 'failed';
export type ShapeCell = { key: string; original: string; value: string; status: ShapeStatus; edited: boolean; editable: boolean; wordId: string | null; start: number; end: number };
export type ShapeRow = { id: string; cells: ShapeCell[] };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const validShapeValue = (value: string) => value === '' || Array.from(segmenter.segment(value)).length === 1 && !/[\r\n\u0000-\u001f\u007f]/u.test(value) && !/[\ud800-\udfff]/u.test(value);

/** Validate the HTTP result once, then bind each complete grapheme to its word. */
export function shapeRows(source: LyricDocument, ids: string[], result: unknown): ShapeRow[] {
  const lines = source.lines.filter(line => ids.includes(line.id));
  const data = result as { rows?: Array<{ id: string; cells: Array<{start:number;end:number;original:string;value:string;status:ShapeStatus}> }> };
  if (!data || !Array.isArray(data.rows) || data.rows.length !== lines.length) throw new Error('字形分析行数不匹配');
  return lines.map((line, index) => {
    const row = data.rows![index], text = lineText(line), units = Array.from(segmenter.segment(text));
    if (!row || row.id !== line.id || !Array.isArray(row.cells) || row.cells.length !== units.length) throw new Error('字形分析行身份或字位无效');
    let offset = 0;
    const words = line.words.map(word => { const start = offset; offset += word.text.length; return { word, start, end: offset }; });
    return { id: line.id, cells: units.map((unit, i) => {
      const cell = row.cells[i], start = unit.index, end = start + unit.segment.length;
      if (!cell || cell.start !== start || cell.end !== end || cell.original !== unit.segment || typeof cell.value !== 'string' || (cell.value !== unit.segment && !validShapeValue(cell.value)) || !['known','ambiguous','failed'].includes(cell.status) || (cell.status === 'failed' ? cell.value !== '' : cell.value === '')) throw new Error('字形分析无法对应原文字位');
      const span = words.find(word => word.start <= start && word.end >= end);
      const han = /\p{Script=Han}/u.test(unit.segment);
      if (!han && cell.value !== unit.segment) throw new Error('字形分析改变了非汉字');
      return { key: `${line.id}:${start}:${end}`, original: unit.segment, value: span ? cell.value : '', status: span ? cell.status : 'failed', edited: false, editable: han && !!span, wordId: span?.word.id ?? null, start: start - (span?.start ?? 0), end: end - (span?.start ?? 0) };
    }) };
  });
}

export function shapeCommand(current: LyricDocument, source: LyricDocument, rows: ShapeRow[]): LyricCommand {
  if (current !== source) throw new Error('源文档已变化，请重新打开转换');
  const commands: Extract<LyricCommand, { type: 'edit-word' }>[] = [];
  for (const row of rows) {
    const line = source.lines.find(line => line.id === row.id)!;
    for (const word of line.words) {
      const cells = row.cells.filter(cell => cell.wordId === word.id && cell.editable);
      if (cells.some(cell => !validShapeValue(cell.value))) throw new Error('每格只能输入一个完整字素，或留空保留原字');
      let text = word.text;
      for (const cell of [...cells].reverse()) if (cell.value) text = text.slice(0, cell.start) + cell.value + text.slice(cell.end);
      if (text !== word.text) commands.push({ type: 'edit-word', lineId: line.id, wordId: word.id, text });
    }
  }
  return { type: 'batch', commands };
}
