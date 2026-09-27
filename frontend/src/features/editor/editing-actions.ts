import type { LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord, type RomanizationContent } from '../../domain/lyric-document';

export type EditorSelection =
  | { kind: 'lines'; ids: string[]; anchorId: string; activeId: string }
  | { kind: 'words'; lineId: string; ids: string[]; anchorId: string; activeId: string; rubyId: string | null };

export type EditorClipboard =
  | { kind: 'lines'; groups: Array<{ line: LyricLine; background: LyricLine | null; romanizations: Array<{ trackId: string; content: RomanizationContent }> }>; text: string }
  | { kind: 'words'; words: LyricWord[]; text: string };

export function selectIds(order: string[], current: string[], anchor: string, id: string, shift: boolean, toggle: boolean): string[] {
  if (shift) {
    const start = order.indexOf(anchor), end = order.indexOf(id);
    if (start < 0 || end < 0) return [id];
    return order.slice(Math.min(start, end), Math.max(start, end) + 1);
  }
  if (toggle) return current.includes(id) ? current.filter((item) => item !== id) : order.filter((item) => current.includes(item) || item === id);
  return [id];
}

export function invertIds(order: string[], selected: string[]): string[] {
  return order.filter((id) => !selected.includes(id));
}

export function copySelection(document: LyricDocument, selection: EditorSelection): EditorClipboard {
  if (selection.kind === 'words') {
    const groups = document.lines.map((line) => line.words.filter((word) => selection.ids.includes(word.id))).filter((words) => words.length);
    return { kind: 'words', words: groups.flat(), text: groups.map((words) => words.map((word) => word.text).join('')).join('\n') };
  }
  const groups = document.lines.filter((line) => !line.backgroundOf && selection.ids.includes(line.id)).map((line) => ({
    line, background: document.lines.find((item) => item.backgroundOf === line.id) ?? null,
    romanizations: document.romanizationTracks.flatMap((track) => track.contents.filter((content) => content.lineId === line.id).map((content) => ({ trackId: track.id, content }))),
  }));
  return { kind: 'lines', groups, text: groups.map(({ line }) => lineText(line)).join('\n') };
}

export function cutSelection(document: LyricDocument, selection: EditorSelection): LyricCommand {
  return { type: 'batch', commands: selection.kind === 'words'
    ? document.lines.flatMap((line) => line.words.filter((word) => selection.ids.includes(word.id)).map((word) => ({ type: 'delete-word' as const, lineId: line.id, wordId: word.id })))
    : selection.ids.map((lineId) => ({ type: 'delete-line', lineId })) };
}

function expandedLineTime(target: LyricLine, words: LyricWord[]) {
  const starts = words.map((word) => word.beginUs).filter((value): value is number => value !== null);
  const ends = words.map((word) => word.endUs).filter((value): value is number => value !== null);
  return { beginUs: target.beginUs === null ? null : Math.min(target.beginUs, ...starts), endUs: target.endUs === null ? null : Math.max(target.endUs, ...ends) };
}

export function moveWordsAcrossLine(document: LyricDocument, selection: Extract<EditorSelection, { kind: 'words' }>, targetLineId: string, afterWordId?: string | null): LyricCommand {
  const target = document.lines.find((line) => line.id === targetLineId)!;
  const selected = document.lines.flatMap((line) => line.words.filter((word) => selection.ids.includes(word.id)).map((word) => ({ line, word })));
  if (selected.some(({ line }) => line.id === target.id)) throw new Error('目标行必须不同于所选词所在行');
  const words = selected.map(({ word }) => word);
  if (!selected.length) throw new Error('请先选择词块');
  const { beginUs, endUs } = expandedLineTime(target, words);
  const commands: Array<Extract<LyricCommand, { type: 'set-line-time' | 'move-word' }>> = [];
  if (beginUs !== target.beginUs || endUs !== target.endUs) commands.push({ type: 'set-line-time', lineId: target.id, beginUs, endUs });
  let after = afterWordId === undefined ? target.words.at(-1)?.id ?? null : afterWordId;
  for (const { line, word } of selected) {
    commands.push({ type: 'move-word', lineId: line.id, wordId: word.id, toLineId: target.id, afterWordId: after });
    after = word.id;
  }
  return { type: 'batch', commands };
}

function cloneWord(word: LyricWord): LyricWord {
  const rubyIds = new Map(word.rubyUnits.map((unit) => [unit.id, crypto.randomUUID()]));
  return { ...word, id: crypto.randomUUID(), rubyUnits: word.rubyUnits.map((unit) => ({ ...unit, id: rubyIds.get(unit.id)! })),
    alignmentUnits: word.alignmentUnits.map((unit) => ({ ...unit, id: crypto.randomUUID(), rubyUnitId: unit.rubyUnitId ? rubyIds.get(unit.rubyUnitId) ?? null : null })) };
}

function cloneLine(line: LyricLine, id: string, backgroundOf: string | null): LyricLine {
  return { ...line, id, backgroundOf, words: line.words.map(cloneWord), translations: line.translations.map((item) => ({ ...item })) };
}

export function pasteRich(document: LyricDocument, clipboard: EditorClipboard, selection: EditorSelection | null): { command: LyricCommand; selection: EditorSelection } {
  const selectedLineId = selection?.kind === 'words' ? selection.lineId : selection?.activeId || selection?.ids.at(-1);
  const currentLine = document.lines.find((line) => line.id === selectedLineId);
  if (clipboard.kind === 'words') {
    if (!currentLine) throw new Error('请先选择粘贴目标行');
    const afterWordId = selection?.kind === 'words' && currentLine.words.some((word) => word.id === selection.activeId) ? selection.activeId : currentLine.words.at(-1)?.id ?? null;
    const words = clipboard.words.map(cloneWord);
    const commands: Array<Extract<LyricCommand, { type: 'set-line-time' | 'insert-word' }>> = [];
    const { beginUs, endUs } = expandedLineTime(currentLine, words);
    if (beginUs !== currentLine.beginUs || endUs !== currentLine.endUs) commands.push({ type: 'set-line-time', lineId: currentLine.id, beginUs, endUs });
    let after = afterWordId;
    for (const word of words) { commands.push({ type: 'insert-word', lineId: currentLine.id, afterWordId: after, word }); after = word.id; }
    return { command: { type: 'batch', commands }, selection: { kind: 'words', lineId: currentLine.id, ids: words.map((word) => word.id), anchorId: words[0].id, activeId: words.at(-1)!.id, rubyId: null } };
  }
  const commands: Array<Extract<LyricCommand, { type: 'insert-line' | 'insert-background' | 'insert-romanization-content' }>> = [];
  const ids: string[] = [];
  let after = currentLine?.backgroundOf ?? currentLine?.id ?? document.lines.filter((line) => !line.backgroundOf).at(-1)?.id ?? null;
  for (const group of clipboard.groups) {
    const id = `line-${crypto.randomUUID()}`;
    const line = cloneLine(group.line, id, null);
    commands.push({ type: 'insert-line', afterLineId: after, line });
    if (group.background) commands.push({ type: 'insert-background', parentLineId: id, line: cloneLine(group.background, `${id}:bg`, id) });
    for (const { trackId, content } of group.romanizations) commands.push({ type: 'insert-romanization-content', trackId, content: content.kind === 'plain'
      ? { ...content, id: crypto.randomUUID(), lineId: id }
      : { ...content, id: crypto.randomUUID(), lineId: id, units: content.units.map((unit) => ({ ...unit, id: crypto.randomUUID() })) } });
    ids.push(id);
    after = id;
  }
  return { command: { type: 'batch', commands }, selection: { kind: 'lines', ids, anchorId: ids[0], activeId: ids.at(-1)! } };
}

export function pastePlain(document: LyricDocument, text: string, selection: EditorSelection | null): { command: LyricCommand; selection: EditorSelection } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '' && lines.length > 1) lines.pop();
  if (lines.length === 1 && selection?.kind === 'words') {
    const word = createWord(lines[0]);
    const line = document.lines.find((item) => item.id === selection.lineId)!;
    const afterWordId = line.words.some((item) => item.id === selection.activeId) ? selection.activeId : line.words.at(-1)?.id ?? null;
    return { command: { type: 'insert-word', lineId: selection.lineId, afterWordId, word },
      selection: { kind: 'words', lineId: selection.lineId, ids: [word.id], anchorId: word.id, activeId: word.id, rubyId: null } };
  }
  const currentLine = document.lines.find((line) => line.id === (selection?.kind === 'words' ? selection.lineId : selection?.activeId || selection?.ids.at(-1)));
  let after = currentLine?.backgroundOf ?? currentLine?.id ?? document.lines.filter((line) => !line.backgroundOf).at(-1)?.id ?? null;
  const commands: Extract<LyricCommand, { type: 'insert-line' }>[] = [];
  for (const value of lines) {
    const line = createLine(value);
    commands.push({ type: 'insert-line', afterLineId: after, line });
    after = line.id;
  }
  return { command: { type: 'batch', commands }, selection: { kind: 'lines', ids: commands.map(({ line }) => line!.id), anchorId: commands[0].line!.id, activeId: commands.at(-1)!.line!.id } };
}
