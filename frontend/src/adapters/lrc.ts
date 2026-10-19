import type { ProjectEditing } from '../domain/project-editing';
import { isUntimedSeparator } from './export-separators';
import { assertOutputDocument, visibleLineOrdinals } from './output-validation';
import { lineText, type LyricDocument, type LyricLine } from '../domain/lyric-document';
export type LrcKind = 'lrc' | 'elrc';
const stamp = (v: number) => `${String(Math.floor(v / 60000)).padStart(2, '0')}:${String(Math.floor(v / 1000) % 60).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`;
function extended(line: LyricLine, editing?: ProjectEditing): string {
  let boundary = line.beginMs!, result = '';
  const emit = (time: number) => { if (time !== boundary) result += `<${stamp(time)}>`; boundary = time; };
  line.words.forEach((word) => {
    if (isUntimedSeparator(word,editing)) { result += word.text; return; }
    const begin = word.beginMs!, end = word.endMs === null ? null : word.endMs;
    emit(begin); result += word.text; if (end !== null) emit(end);
  });
  return result;
}
/** Pure export projection: inferred ends never become source times. */
export function renderLrc(document: LyricDocument, kind: LrcKind = 'lrc', editing?: ProjectEditing): { text: string; overlapLines: number[] } {
  assertOutputDocument(document,kind,editing);
  const ordinals=visibleLineOrdinals(document);
  const rows = document.lines.map((line) => ({ line, ordinal: ordinals.get(line.id)! })).filter(({ line }) => !line.backgroundOf);
  rows.sort((a, b) => a.line.beginMs! - b.line.beginMs!);
  const output: string[] = [], overlap = new Set<number>();
  let groupEnd: number | null | undefined;
  let groupRows: typeof rows = [];
  for (const row of rows) {
    const { line, ordinal } = row;
    const begin = line.beginMs!, end = line.endMs === null ? null : line.endMs;
    if (groupEnd !== undefined && groupEnd !== null && begin > groupEnd) {
      output.push(`[${stamp(groupEnd)}]`); groupRows = []; groupEnd = undefined;
    }
    for (const other of groupRows) if (other.line.beginMs! === begin || (other.line.endMs !== null && other.line.endMs > begin)) { overlap.add(other.ordinal); overlap.add(ordinal); }
    output.push(`[${stamp(begin)}]${kind === 'elrc' ? extended(line,editing) : lineText(line)}`);
    groupEnd = groupEnd === null || end === null ? null : Math.max(groupEnd ?? end, end);
    groupRows.push(row);
  }
  if (groupEnd !== undefined && groupEnd !== null && groupEnd > rows.at(-1)!.line.beginMs!) output.push(`[${stamp(groupEnd)}]`);
  return { text: output.join('\n') + '\n', overlapLines: [...overlap].sort((a, b) => a - b) };
}
