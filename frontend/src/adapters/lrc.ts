import { assertOutputDocument, visibleLineOrdinals } from './output-validation';
import { lineText, type LyricDocument, type LyricLine } from '../domain/lyric-document';
export type LrcKind = 'lrc' | 'elrc';
const ms = (us: number) => us;
const stamp = (v: number) => `${String(Math.floor(v / 60000)).padStart(2, '0')}:${String(Math.floor(v / 1000) % 60).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`;
function extended(line: LyricLine, ordinal: number): string {
  let boundary = ms(line.beginMs!), result = '';
  const emit = (time: number) => { if (time !== boundary) result += `<${stamp(time)}>`; boundary = time; };
  line.words.forEach((word, index) => {
    if (!word.text.trim() && word.beginMs === null) { result += word.text; return; }
    if (word.beginMs === null) throw new Error(`第 ${ordinal} 行第 ${index + 1} 单元缺少开始时间`);
    const begin = ms(word.beginMs), end = word.endMs === null ? null : ms(word.endMs);
    if (begin < boundary || (end !== null && end < begin)) throw new Error(`第 ${ordinal} 行第 ${index + 1} 单元时间倒序或重叠，无法输出扩展 LRC`);
    emit(begin); result += word.text; if (end !== null) emit(end);
  });
  return result;
}
/** Pure export projection: inferred ends never become source times. */
export function renderLrc(document: LyricDocument, kind: LrcKind = 'lrc'): { text: string; overlapLines: number[] } {
  assertOutputDocument(document,kind);
  const ordinals=visibleLineOrdinals(document);
  const rows = document.lines.map((line) => ({ line, ordinal: ordinals.get(line.id)! })).filter(({ line }) => !line.backgroundOf);
  for (const { line, ordinal } of rows) {
    if (line.beginMs === null) throw new Error(`第 ${ordinal} 行缺少开始时间`);
    if (line.endMs !== null && ms(line.endMs) < ms(line.beginMs)) throw new Error(`第 ${ordinal} 行结束早于开始`);
  }
  rows.sort((a, b) => ms(a.line.beginMs!) - ms(b.line.beginMs!));
  const output: string[] = [], overlap = new Set<number>();
  let groupEnd: number | null | undefined;
  let groupRows: typeof rows = [];
  for (const row of rows) {
    const { line, ordinal } = row;
    const begin = ms(line.beginMs!), end = line.endMs === null ? null : ms(line.endMs);
    if (groupEnd !== undefined && groupEnd !== null && begin > groupEnd) {
      output.push(`[${stamp(groupEnd)}]`); groupRows = []; groupEnd = undefined;
    }
    for (const other of groupRows) if (ms(other.line.beginMs!) === begin || (other.line.endMs !== null && ms(other.line.endMs) > begin)) { overlap.add(other.ordinal); overlap.add(ordinal); }
    output.push(`[${stamp(begin)}]${kind === 'elrc' ? extended(line, ordinal) : lineText(line)}`);
    groupEnd = groupEnd === null || end === null ? null : Math.max(groupEnd ?? end, end);
    groupRows.push(row);
  }
  if (groupEnd !== undefined && groupEnd !== null && groupEnd > ms(rows.at(-1)!.line.beginMs!)) output.push(`[${stamp(groupEnd)}]`);
  return { text: output.join('\n') + '\n', overlapLines: [...overlap].sort((a, b) => a - b) };
}
