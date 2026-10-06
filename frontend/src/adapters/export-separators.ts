import type { ProjectEditing } from '../domain/project-editing';
import type { TimeMs, LyricWord } from '../domain/lyric-document';

export type ExportUnit = { id: string; text: string; beginMs: TimeMs; endMs: TimeMs };
/** Unicode horizontal spaces; tabs and line separators have different format semantics. */
export function isUntimedSeparator(unit: ExportUnit & Partial<Pick<LyricWord, 'rubyUnits' | 'obscene'>>, editing?: ProjectEditing) {
  return /^[\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+$/u.test(unit.text)
    && unit.beginMs === null && unit.endMs === null && !unit.rubyUnits?.length && !unit.obscene && !editing?.emptyBeats[unit.id];
}
/** Copy only: a missing body unit is a barrier, never a bridge to a distant host. */
export function projectExportSeparators<T extends ExportUnit>(units: T[], editing?: ProjectEditing) {
  const projected: T[] = [], unhosted: T[] = [];
  const valid = (unit: T) => unit.beginMs !== null && unit.endMs !== null && unit.endMs >= unit.beginMs;
  for (let index = 0; index < units.length;) {
    const unit = units[index];
    if (!isUntimedSeparator(unit, editing)) { projected.push({ ...unit }); index++; continue; }
    const run: T[] = [];
    while (index < units.length && isUntimedSeparator(units[index], editing)) run.push(units[index++]);
    const text = run.map(item => item.text).join(''), previous = projected.at(-1);
    if (previous && valid(previous)) previous.text += text;
    else if (!previous && units[index] && valid(units[index])) {
      projected.push({ ...units[index], text: text + units[index].text }); index++;
    } else unhosted.push(...run);
  }
  return { units: projected, unhosted };
}

/** TTML's xml:space=preserve can also carry actual tabs and line breaks as body text. */
export function isUntimedXmlWhitespace(unit: ExportUnit & Partial<Pick<LyricWord, 'rubyUnits' | 'obscene'>>, editing?: ProjectEditing) {
  return /^[\p{Zs}\t\r\n\u2028\u2029\uFEFF]+$/u.test(unit.text) && isUntimedSeparator({ ...unit, text: ' ' }, editing);
}
