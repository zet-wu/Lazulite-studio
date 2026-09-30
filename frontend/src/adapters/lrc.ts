import { lineText, type LyricDocument, type LyricLine } from '../domain/lyric-document';
export type LrcKind = 'lrc' | 'elrc';
const ms = (us: number) => Math.round(us / 1000);
const stamp = (v: number) => `${String(Math.floor(v / 60000)).padStart(2, '0')}:${String(Math.floor(v / 1000) % 60).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`;
function extended(line: LyricLine, ordinal: number): string {
  let boundary = ms(line.beginUs!), result = '';
  const emit = (time: number) => { if (time !== boundary) result += `<${stamp(time)}>`; boundary = time; };
  line.words.forEach((word, index) => {
    if (!word.text.trim() && word.beginUs === null) { result += word.text; return; }
    if (word.beginUs === null) throw new Error(`第 ${ordinal} 行第 ${index + 1} 单元缺少开始时间`);
    const begin = ms(word.beginUs), end = word.endUs === null ? null : ms(word.endUs);
    if (begin < boundary || (end !== null && end < begin)) throw new Error(`第 ${ordinal} 行第 ${index + 1} 单元时间倒序或重叠，无法输出扩展 LRC`);
    emit(begin); result += word.text; if (end !== null) emit(end);
  });
  return result;
}
/** Pure export projection: inferred ends never become source times. */
export function renderLrc(document: LyricDocument, kind: LrcKind = 'lrc'): { text: string; overlapLines: number[] } {
  const rows = document.lines.map((line, index) => ({ line, ordinal: index + 1 })).filter(({ line }) => !line.backgroundOf);
  for (const { line, ordinal } of rows) {
    if (line.beginUs === null) throw new Error(`第 ${ordinal} 行缺少开始时间`);
    if (line.endUs !== null && ms(line.endUs) < ms(line.beginUs)) throw new Error(`第 ${ordinal} 行结束早于开始`);
  }
  rows.sort((a, b) => ms(a.line.beginUs!) - ms(b.line.beginUs!));
  const output: string[] = [], overlap = new Set<number>();
  let groupEnd: number | null | undefined;
  let groupRows: typeof rows = [];
  for (const row of rows) {
    const { line, ordinal } = row;
    const begin = ms(line.beginUs!), end = line.endUs === null ? null : ms(line.endUs);
    if (groupEnd !== undefined && groupEnd !== null && begin > groupEnd) {
      output.push(`[${stamp(groupEnd)}]`); groupRows = []; groupEnd = undefined;
    }
    for (const other of groupRows) if (ms(other.line.beginUs!) === begin || (other.line.endUs !== null && ms(other.line.endUs) > begin)) { overlap.add(other.ordinal); overlap.add(ordinal); }
    output.push(`[${stamp(begin)}]${kind === 'elrc' ? extended(line, ordinal) : lineText(line)}`);
    groupEnd = groupEnd === null || end === null ? null : Math.max(groupEnd ?? end, end);
    groupRows.push(row);
  }
  if (groupEnd !== undefined && groupEnd !== null && groupEnd > ms(rows.at(-1)!.line.beginUs!)) output.push(`[${stamp(groupEnd)}]`);
  return { text: output.join('\n') + '\n', overlapLines: [...overlap].sort((a, b) => a - b) };
}
