import { wordAgents, lineAgents, sameAgents } from '../../domain/amll-compatibility';
import { createProjectEditing, remapEditing, type ProjectEditing } from '../../domain/project-editing';
import { applyLyricCommand, type LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord, type RomanizationContent, type RomanizationUnit, type RubyUnit } from '../../domain/lyric-document';

import { attachmentTracks, type ObjectSelection } from '../../domain/selection-editing';
export type EditorSelection = ObjectSelection;

export type EditorClipboard = (
  | { kind: 'lines'; groups: Array<{ line: LyricLine; backgrounds: LyricLine[]; translations: Array<{ trackId: string; content: RomanizationContent }>; romanizations: Array<{ trackId: string; content: RomanizationContent }> }>; text: string }
  | { kind: 'words'; words: LyricWord[]; sources?: Record<string,string[]>; text: string }
  | { kind: 'ruby'; units: RubyUnit[]; text: string }
  | { kind: 'romanization-content'; trackId: string; contents: RomanizationContent[]; text: string }
  | { kind: 'romanization-unit'; trackId: string; contentId: string; units: RomanizationUnit[]; text: string }) & { editing?: ProjectEditing; attachment?: 'translation' };

export const selectionLineId = (selection: EditorSelection | null): string | null => selection?.kind === 'lines' ? selection.activeId || null : selection?.lineId ?? null;

export function selectIds(order: string[], current: string[], anchor: string, id: string, shift: boolean, toggle: boolean): string[] {
  if (shift) {
    const start = order.indexOf(anchor), end = order.indexOf(id);
    if (start < 0 || end < 0) return [id];
    return order.slice(Math.min(start, end), Math.max(start, end) + 1);
  }
  if (toggle) return current.includes(id) ? current.filter((item) => item !== id) : [...current.filter(item => !order.includes(item)), ...order.filter(item => current.includes(item) || item === id)];
  return [id];
}

export function invertIds(order: string[], selected: string[]): string[] {
  return order.filter((id) => !selected.includes(id));
}

export function copySelection(document: LyricDocument, selection: EditorSelection, editing = createProjectEditing()): EditorClipboard {
  const translated = (selection.kind === 'romanization-content' || selection.kind === 'romanization-unit') && selection.attachment === 'translation';
  const result = copyObjects(translated ? { ...document, romanizationTracks: document.translationTracks } : document, selection);
  if(translated)result.attachment='translation';
  const ids = new Map<string, string>();
  const collect = (value: unknown) => { if (!value || typeof value !== 'object') return; if ('id' in value && typeof value.id === 'string') ids.set(value.id, value.id); Object.values(value).forEach(collect); };
  collect(result);
  return { ...result, editing: remapEditing(editing, ids) };
}
function copyObjects(document: LyricDocument, selection: EditorSelection): EditorClipboard {
  if (selection.kind === 'ruby') {
    const units = document.lines.flatMap(line => line.words.flatMap(word => word.rubyUnits.filter(unit => selection.ids.includes(unit.id))));
    return { kind: 'ruby', units, text: units.map((unit) => unit.reading).join('') };
  }
  if (selection.kind === 'romanization-content' || selection.kind === 'romanization-unit') {
    const track = document.romanizationTracks.find((item) => item.id === selection.trackId);
    const content = track?.contents.find((item) => item.id === selection.contentId);
    if (!content) throw new Error('音译内容不存在');
    if (selection.kind === 'romanization-content') {
      const contents = track!.contents.filter((item) => item.lineId === selection.lineId && selection.ids.includes(item.id));
      return { kind: 'romanization-content', trackId: selection.trackId, contents, text: contents.map((item) => item.kind === 'plain' ? item.text : item.units.map((unit) => unit.text).join('')).join('\n') };
    }
    if (content.kind !== 'timed') throw new Error('请选择音译单元');
    const selectedContents = document.romanizationTracks.flatMap(track => track.contents.filter(item => item.kind === 'timed' && item.units.some(unit => selection.ids.includes(unit.id))));
    if (selectedContents.length !== 1) throw new Error('跨内容音译复制暂不支持，请选择同一份内容');
    const units = content.units.filter((unit) => selection.ids.includes(unit.id));
    return { kind: 'romanization-unit', trackId: selection.trackId, contentId: content.id, units, text: units.map((unit) => unit.text).join('') };
  }
  if (selection.kind === 'words') {
    const groups = document.lines.map((line) => line.words.filter((word) => selection.ids.includes(word.id))).filter((words) => words.length);
    return { kind: 'words', sources:Object.fromEntries(document.lines.flatMap(line=>line.words.map(word=>[word.id,wordAgents(document,line,word)]))), words: groups.flat(), text: groups.map((words) => words.map((word) => word.text).join('')).join('\n') };
  }
  const groups = document.lines.filter((line) => !line.backgroundOf && (selection.ids.includes(line.id) || document.lines.some(child => child.backgroundOf === line.id && selection.ids.includes(child.id)))).map((line) => ({
    line, backgrounds: document.lines.filter((item) => item.backgroundOf === line.id),
    translations: document.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === line.id || document.lines.some(bg => bg.id === content.lineId && bg.backgroundOf === line.id)).map(content => ({ trackId: track.id, content }))),
    romanizations: document.romanizationTracks.flatMap((track) => track.contents.filter((content) => (content.lineId === line.id || document.lines.some(bg => bg.id === content.lineId && bg.backgroundOf === line.id))).map((content) => ({ trackId: track.id, content }))),
  }));
  return { kind: 'lines', groups, text: groups.map(({ line }) => lineText(line)).join('\n') };
}

export function deleteSelection(document: LyricDocument, selection: EditorSelection): LyricCommand {
  if((selection.kind==='romanization-content'||selection.kind==='romanization-unit')&&selection.attachment==='translation') {
    const tracks=document.translationTracks.map(track=>({...track,contents:selection.kind==='romanization-content'?track.contents.filter(content=>!selection.ids.includes(content.id)):track.contents.map(content=>content.kind==='plain'?content:{...content,units:content.units.filter(unit=>!selection.ids.includes(unit.id))})}));
    return {type:'set-translation-tracks',source:document.translationTracks,tracks};
  }
  if (selection.kind === 'ruby') return { type: 'batch', commands: document.lines.flatMap(line => line.words.flatMap(word => word.rubyUnits.filter(unit => selection.ids.includes(unit.id)).map(unit => ({ type: 'delete-ruby' as const, lineId: line.id, wordId: word.id, rubyId: unit.id })))) };
  if (selection.kind === 'romanization-content') return { type: 'batch', commands: selection.ids.map((contentId) => ({ type: 'delete-romanization-content', trackId: selection.trackId, contentId })) };
  if (selection.kind === 'romanization-unit') {
    return { type: 'batch', commands: document.romanizationTracks.flatMap(track => track.contents.flatMap(content => content.kind === 'timed' && content.units.some(unit => selection.ids.includes(unit.id)) ? [{ type: 'set-romanization-content' as const, trackId: track.id, content: { ...content, units: content.units.filter(unit => !selection.ids.includes(unit.id)) } }] : [])) };
  }
  return { type: 'batch', commands: selection.kind === 'words'
    ? document.lines.flatMap((line) => line.words.filter((word) => selection.ids.includes(word.id)).map((word) => ({ type: 'delete-word' as const, lineId: line.id, wordId: word.id })))
    : selection.ids.filter(id => { const line = document.lines.find(line => line.id === id); return !line?.backgroundOf || !selection.ids.includes(line.backgroundOf); }).map((lineId) => ({ type: 'delete-line', lineId })) };
}

// Cutting uses the same atomic deletion as direct object deletion.
export const cutSelection = deleteSelection;

function expandedLineTime(target: LyricLine, words: LyricWord[]) {
  const starts = words.map((word) => word.beginMs).filter((value): value is number => value !== null);
  const ends = words.map((word) => word.endMs).filter((value): value is number => value !== null);
  return { beginMs: target.beginMs === null ? null : Math.min(target.beginMs, ...starts), endMs: target.endMs === null ? null : Math.max(target.endMs, ...ends) };
}

export function moveWordsAcrossLine(document: LyricDocument, selection: Extract<EditorSelection, { kind: 'words' }>, targetLineId: string, afterWordId?: string | null): LyricCommand {
  const target = document.lines.find((line) => line.id === targetLineId)!;
  const selected = document.lines.flatMap((line) => line.words.filter((word) => selection.ids.includes(word.id)).map((word) => ({ line, word })));
  if (selected.some(({ line }) => line.id === target.id)) throw new Error('目标行必须不同于所选词所在行');
  const words = selected.map(({ word }) => word);
  if (!selected.length) throw new Error('请先选择词块');
  const { beginMs, endMs } = expandedLineTime(target, words);
  const commands: Array<Extract<LyricCommand, { type: 'set-line-time' | 'move-word' }>> = [];
  if (beginMs !== target.beginMs || endMs !== target.endMs) commands.push({ type: 'set-line-time', lineId: target.id, beginMs, endMs });
  let after = afterWordId === undefined ? target.words.at(-1)?.id ?? null : afterWordId;
  for (const { line, word } of selected) {
    commands.push({ type: 'move-word', lineId: line.id, wordId: word.id, toLineId: target.id, afterWordId: after });
    after = word.id;
  }
  return { type: 'batch', commands };
}

function cloneWord(word: LyricWord, ids: Map<string, string>): LyricWord {
  const rubyIds = new Map(word.rubyUnits.map(unit => [unit.id, copyId(unit.id, ids)]));
  return { ...word, id: copyId(word.id, ids), rubyUnits: word.rubyUnits.map((unit) => ({ ...unit, id: rubyIds.get(unit.id)! })) };
}

function cloneLine(line: LyricLine, id: string, backgroundOf: string | null, ids: Map<string, string>): LyricLine {
  ids.set(line.id, id);
  return { ...line, id, backgroundOf, words: line.words.map(word => cloneWord(word, ids)) };
}

function copyId(id: string, ids: Map<string, string>) { const next = crypto.randomUUID(); ids.set(id, next); return next; }
export function pasteRich(document: LyricDocument, clipboard: EditorClipboard, selection: EditorSelection | null): { command: LyricCommand; selection: EditorSelection } {
  if(clipboard.attachment==='translation') {
    const result=pasteRich({...document,romanizationTracks:document.translationTracks},{...clipboard,attachment:undefined},selection);
    const tracks=applyLyricCommand({...document,romanizationTracks:document.translationTracks},result.command).romanizationTracks;
    return {command:{type:'set-translation-tracks',source:document.translationTracks,tracks:tracks.map(track=>({...document.translationTracks.find(item=>item.id===track.id)!,...track}))},selection:{...result.selection,attachment:'translation'} as EditorSelection};
  }
  const ids = new Map<string, string>();
  const result = pasteObjects(document, clipboard, selection, ids);
  if (!clipboard.editing) return result;
  const command: LyricCommand = { type: 'batch', commands: [...(result.command.type === 'batch' ? result.command.commands : [result.command]), { type: 'restore-editing', editing: remapEditing(clipboard.editing, ids) }] };
  return { ...result, command };
}
function pasteObjects(document: LyricDocument, clipboard: EditorClipboard, selection: EditorSelection | null, idMap: Map<string, string>): { command: LyricCommand; selection: EditorSelection } {
  const selectedLineId = selectionLineId(selection);
  const currentLine = document.lines.find((line) => line.id === selectedLineId);
  if (clipboard.kind === 'ruby') {
    if (selection?.kind !== 'ruby') throw new Error('请先选择目标读音单元');
    const word = currentLine?.words.find((item) => item.id === selection.wordId);
    if (!word) throw new Error('读音所属词不存在');
    const copied = clipboard.units.map((unit) => ({ ...unit, id: copyId(unit.id, idMap) }));
    const commands: Array<Extract<LyricCommand, { type: 'insert-ruby' | 'set-ruby-time' }>> = [];
    let afterRubyId = selection.activeId;
    for (const unit of copied) {
      commands.push({ type: 'insert-ruby', lineId: selection.lineId, wordId: word.id, afterRubyId, reading: unit.reading, rubyId: unit.id });
      if (unit.beginMs !== null || unit.endMs !== null) commands.push({ type: 'set-ruby-time', lineId: selection.lineId, wordId: word.id, rubyId: unit.id, beginMs: unit.beginMs, endMs: unit.endMs });
      afterRubyId = unit.id;
    }
    return { command: { type: 'batch', commands },
      selection: { ...selection, ids: copied.map((unit) => unit.id), anchorId: copied[0].id, activeId: copied.at(-1)!.id } };
  }
  if (clipboard.kind === 'romanization-content') {
    if (!currentLine) throw new Error('请先选择歌词行');
    const contents = clipboard.contents.map((content) => content.kind === 'plain'
      ? { ...content, id: crypto.randomUUID(), lineId: currentLine.id }
      : { ...content, id: crypto.randomUUID(), lineId: currentLine.id, units: content.units.map((unit) => ({ ...unit, id: crypto.randomUUID() })) });
    return { command: { type: 'batch', commands: contents.map((content) => ({ type: 'insert-romanization-content', trackId: clipboard.trackId, content })) },
      selection: { kind: 'romanization-content', lineId: currentLine.id, trackId: clipboard.trackId, contentId: contents.at(-1)!.id, ids: contents.map((content) => content.id), anchorId: contents[0].id, activeId: contents.at(-1)!.id } };
  }
  if (clipboard.kind === 'romanization-unit') {
    if (selection?.kind !== 'romanization-unit' && selection?.kind !== 'romanization-content') throw new Error('请先选择定时音译内容');
    const content = document.romanizationTracks.find((track) => track.id === selection.trackId)?.contents.find((item) => item.id === selection.contentId);
    if (!content || content.kind !== 'timed') throw new Error('请先选择定时音译内容');
    const units = content.units.slice();
    const after = selection.kind === 'romanization-unit' ? units.findIndex((unit) => unit.id === selection.activeId) : units.length - 1;
    const copied = clipboard.units.map((unit) => ({ ...unit, id: copyId(unit.id, idMap) }));
    units.splice(after + 1, 0, ...copied);
    return { command: { type: 'set-romanization-content', trackId: selection.trackId, content: { ...content, units } },
      selection: { kind: 'romanization-unit', lineId: selection.lineId, trackId: selection.trackId, contentId: content.id, ids: copied.map((unit) => unit.id), anchorId: copied[0].id, activeId: copied.at(-1)!.id } };
  }
  if (clipboard.kind === 'words') {
    if (!currentLine) throw new Error('请先选择粘贴目标行');
    const afterWordId = selection?.kind === 'words' && currentLine.words.some((word) => word.id === selection.activeId) ? selection.activeId : currentLine.words.at(-1)?.id ?? null;
    const words = clipboard.words.map(word => {const effective=clipboard.sources?.[word.id]; if(!word.agentRefs&&effective&&!sameAgents(effective,lineAgents(document,currentLine))) {if(!effective.length)throw new Error('无歌手词无法在有歌手目标行中保真');return cloneWord({...word,agentRefs:effective},idMap);}return cloneWord(word,idMap);});
    const commands: Array<Extract<LyricCommand, { type: 'set-line-time' | 'insert-word' }>> = [];
    const { beginMs, endMs } = expandedLineTime(currentLine, words);
    if (beginMs !== currentLine.beginMs || endMs !== currentLine.endMs) commands.push({ type: 'set-line-time', lineId: currentLine.id, beginMs, endMs });
    let after = afterWordId;
    for (const word of words) { commands.push({ type: 'insert-word', lineId: currentLine.id, afterWordId: after, word }); after = word.id; }
    return { command: { type: 'batch', commands }, selection: { kind: 'words', lineId: currentLine.id, ids: words.map((word) => word.id), anchorId: words[0].id, activeId: words.at(-1)!.id } };
  }
  const commands: Array<Extract<LyricCommand, { type: 'insert-line' | 'set-background-of' | 'insert-romanization-content' | 'insert-translation-content' }>> = [];
  const ids: string[] = [];
  let after = currentLine?.backgroundOf ?? currentLine?.id ?? document.lines.filter((line) => !line.backgroundOf).at(-1)?.id ?? null;
  for (const group of clipboard.groups) {
    const id = `line-${crypto.randomUUID()}`;
    const line = cloneLine(group.line, id, null, idMap);
    commands.push({ type: 'insert-line', afterLineId: after, line });
    for (const original of group.backgrounds) {
      const background = cloneLine(original, `bg-${crypto.randomUUID()}`, null, idMap);
      commands.push({ type: 'insert-line', afterLineId: id, line: background });
      commands.push({ type: 'set-background-of', lineId: background.id, parentLineId: id });
    }
    for (const { trackId, content } of group.romanizations) commands.push({ type: 'insert-romanization-content', trackId, content: content.kind === 'plain'
      ? { ...content, id: crypto.randomUUID(), lineId: idMap.get(content.lineId)! }
      : { ...content, id: crypto.randomUUID(), lineId: idMap.get(content.lineId)!, units: content.units.map((unit) => ({ ...unit, id: crypto.randomUUID() })) } });
    for (const { trackId, content } of group.translations) commands.push({ type: 'insert-translation-content', trackId, content: content.kind === 'plain'
      ? { ...content, id: crypto.randomUUID(), lineId: idMap.get(content.lineId)! }
      : { ...content, id: crypto.randomUUID(), lineId: idMap.get(content.lineId)!, units: content.units.map((unit) => ({ ...unit, id: crypto.randomUUID() })) } });
    ids.push(id);
    after = id;
  }
  return { command: { type: 'batch', commands }, selection: { kind: 'lines', ids, anchorId: ids[0], activeId: ids.at(-1)! } };
}

export function pastePlain(document: LyricDocument, text: string, selection: EditorSelection | null): { command: LyricCommand; selection: EditorSelection } {
  if((selection?.kind==='romanization-content'||selection?.kind==='romanization-unit')&&selection.attachment==='translation') {
    const result=pastePlain({...document,romanizationTracks:document.translationTracks},text,{...selection,attachment:undefined});
    const tracks=applyLyricCommand({...document,romanizationTracks:document.translationTracks},result.command).romanizationTracks;
    return {command:{type:'set-translation-tracks',source:document.translationTracks,tracks:tracks.map(track=>({...document.translationTracks.find(item=>item.id===track.id)!,...track}))},selection:{...result.selection,attachment:'translation'} as EditorSelection};
  }
  if (selection?.kind === 'ruby') {
    const rubyId = crypto.randomUUID();
    return { command: { type: 'insert-ruby', lineId: selection.lineId, wordId: selection.wordId, afterRubyId: selection.activeId, reading: text, rubyId },
      selection: { ...selection, ids: [rubyId], anchorId: rubyId, activeId: rubyId } };
  }
  if (selection?.kind === 'romanization-content') {
    const content = { id: crypto.randomUUID(), lineId: selection.lineId, kind: 'plain' as const, text };
    return { command: { type: 'insert-romanization-content', trackId: selection.trackId, content }, selection: { ...selection, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id } };
  }
  if (selection?.kind === 'romanization-unit') {
    const content = document.romanizationTracks.find((track) => track.id === selection.trackId)?.contents.find((item) => item.id === selection.contentId);
    if (!content || content.kind !== 'timed') throw new Error('请选择定时音译内容');
    const unit = { id: crypto.randomUUID(), text, beginMs: null, endMs: null };
    const units = content.units.slice();
    const after = units.findIndex((item) => item.id === selection.activeId);
    units.splice(after + 1, 0, unit);
    return { command: { type: 'set-romanization-content', trackId: selection.trackId, content: { ...content, units } }, selection: { ...selection, ids: [unit.id], anchorId: unit.id, activeId: unit.id } };
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '' && lines.length > 1) lines.pop();
  if (lines.length === 1 && selection?.kind === 'words') {
    const word = createWord(lines[0]);
    const line = document.lines.find((item) => item.id === selection.lineId)!;
    const afterWordId = line.words.some((item) => item.id === selection.activeId) ? selection.activeId : line.words.at(-1)?.id ?? null;
    return { command: { type: 'insert-word', lineId: selection.lineId, afterWordId, word },
      selection: { kind: 'words', lineId: selection.lineId, ids: [word.id], anchorId: word.id, activeId: word.id } };
  }
  const currentLine = document.lines.find((line) => line.id === selectionLineId(selection));
  let after = currentLine?.backgroundOf ?? currentLine?.id ?? document.lines.filter((line) => !line.backgroundOf).at(-1)?.id ?? null;
  const commands: Extract<LyricCommand, { type: 'insert-line' }>[] = [];
  for (const value of lines) {
    const line = createLine(value);
    commands.push({ type: 'insert-line', afterLineId: after, line });
    after = line.id;
  }
  return { command: { type: 'batch', commands }, selection: { kind: 'lines', ids: commands.map(({ line }) => line!.id), anchorId: commands[0].line!.id, activeId: commands.at(-1)!.line!.id } };
}
