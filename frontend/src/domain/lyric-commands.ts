import { message, MessageError, messageList, type Message } from './messages';
import { shiftLineTimes } from './batch-editing';
import { preserveWordAgents, wordAgents, sameAgents, validateAgents, lineAgents } from './amll-compatibility';
import { createProjectEditing, emptyBeatCount, setEmptyBeat, reconcileEditing, validateProjectEditing, type ProjectEditing } from './project-editing';
import { lineStructureIssues } from './line-structure';
import { validateTranslationTracks } from './translation-editing';
import { createLine, createWord, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RomanizationContent, type RomanizationTrack, type RubyUnit, type TranslationTrack, type TranslationContent, type TimeMs } from './lyric-document';
import { splitAtGrapheme } from './text-boundaries';
import { distributeRubyTime, isKanaReading, splitReadingMora } from './ruby-editing';
import { stampSync, type SyncAction, type SyncCursor, type SyncMode } from './sync-editing';

type AtomicLyricCommand =
  | { type: 'shift-lines'; lineIds: string[]; deltaMs: number }
  | { type: 'insert-line'; afterLineId: string | null; line?: LyricLine; sourceGroupId?: string }
  | { type: 'set-background-of'; lineId: string; parentLineId: string | null }
  | { type: 'delete-line'; lineId: string }
  | { type: 'move-line'; lineId: string; afterLineId: string | null }
  | ({ type: 'split-line' } & LineSplitPlan)
  | { type: 'merge-lines'; lineIds: string[] }
  | { type: 'insert-word'; lineId: string; afterWordId: string | null; word: LyricWord }
  | { type: 'delete-word'; lineId: string; wordId: string }
  | { type: 'segment-word'; lineId: string; wordId: string; words: LyricWord[] }
  | { type: 'segment-words'; changes: Array<{ lineId: string; wordId: string; words: LyricWord[] }> }
  | { type: 'merge-words'; wordIds: string[] }
  | { type: 'move-word'; lineId: string; wordId: string; toLineId: string; afterWordId: string | null }
  | { type: 'set-line-time'; lineId: string; beginMs: TimeMs; endMs: TimeMs }
  | { type: 'link-line-end'; lineId: string; targetLineId: string }
  | { type: 'unlink-line-end'; lineId: string }
  | { type: 'set-word-agents'; lineId: string; wordId: string; agentRefs: string[] }
  | { type: 'set-song-part'; lineIds: string[]; value: string | null }
  | { type: 'set-line-agents'; lineId: string; agentRefs: string[] }
  | { type: 'set-skip-alignment'; lineId: string; skip: boolean }
  | { type: 'set-ignore-sync'; lineId: string; ignoreSync: boolean }
  | { type: 'set-translation-tracks'; tracks: TranslationTrack[]; source: TranslationTrack[] }
  | { type: 'insert-translation-content'; trackId: string; content: TranslationContent }
  | { type: 'add-romanization-track'; track: RomanizationTrack }
  | { type: 'delete-romanization-track'; trackId: string }
  | { type: 'set-romanization-track-language'; trackId: string; language: string | null }
  | { type: 'move-romanization-track'; trackId: string; direction: -1 | 1 }
  | { type: 'insert-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'set-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'delete-romanization-content'; trackId: string; contentId: string }
  | { type: 'move-romanization-content'; trackId: string; contentId: string; afterContentId: string | null; lineId: string }
  | { type: 'split-romanization-unit'; trackId: string; contentId: string; unitId: string; at: number }
  | { type: 'move-romanization-unit'; trackId: string; contentId: string; unitId: string; afterUnitId: string | null }
  | { type: 'set-metadata'; key: string; values: string[] }
  | { type: 'set-language'; language: string | null }
  | { type: 'set-agents'; agents: LyricAgent[] }
  | { type: 'rename-agent'; id: string; nextId: string }
  | { type: 'delete-agent'; id: string }
  | { type: 'rename-metadata'; key: string; nextKey: string }
  | { type: 'sync-stamp'; cursor: SyncCursor; action: SyncAction; timeMs: number; mode?: SyncMode }
  | { type: 'replace-document'; document: LyricDocument; editing?: ProjectEditing }
  | { type: 'restore-editing'; editing: ProjectEditing }
  | { type: 'set-empty-beat'; kind: 'word' | 'ruby'; id: string; count: number }
  | { type: 'split-word'; lineId: string; wordId: string; at: number; newWordId?: string }
  | { type: 'set-word-obscene'; lineId: string; wordId: string; obscene: boolean }
  | { type: 'edit-word'; lineId: string; wordId: string; text: string }
  | { type: 'set-word-time'; lineId: string; wordId: string; beginMs: TimeMs; endMs: TimeMs }
  | { type: 'add-ruby'; lineId: string; wordId: string; reading: string; rubyId?: string }
  | { type: 'insert-ruby'; lineId: string; wordId: string; afterRubyId: string | null; reading: string; rubyId?: string }
  | { type: 'merge-ruby'; rubyIds: string[] }
  | { type: 'move-ruby'; lineId: string; wordId: string; rubyId: string; rubyIds?: string[]; toWordId?: string; afterRubyId: string | null }
  | { type: 'set-ruby-units'; lineId: string; wordId: string; units: RubyUnit[]; overwrite?: boolean }
  | { type: 'redistribute-ruby-time'; lineId: string; wordId: string }
  | { type: 'set-word-empty-beat'; lineId: string; wordId: string; emptyBeat: number }
  | { type: 'split-ruby'; lineId: string; wordId: string; rubyId: string; at: number; newRubyId?: string }
  | { type: 'edit-ruby'; lineId: string; wordId: string; rubyId: string; reading: string }
  | { type: 'delete-ruby'; lineId: string; wordId: string; rubyId: string }
  | { type: 'set-ruby-time'; lineId: string; wordId: string; rubyId: string; beginMs: TimeMs; endMs: TimeMs };

export type LyricCommand = AtomicLyricCommand | { type: 'batch'; commands: AtomicLyricCommand[] };
type WordCommand = Extract<AtomicLyricCommand, { type: 'set-word-agents' | 'set-word-obscene' | 'split-word' | 'edit-word' | 'set-word-time' | 'add-ruby' | 'insert-ruby' | 'set-ruby-units' | 'redistribute-ruby-time' | 'set-word-empty-beat' | 'split-ruby' | 'edit-ruby' | 'delete-ruby' | 'set-ruby-time' }>;

function validTime(beginMs: TimeMs, endMs: TimeMs) {
  for (const value of [beginMs, endMs]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new MessageError(message('command.timeInvalid'));
  if (beginMs !== null && endMs !== null && beginMs > endMs) throw new MessageError(message('command.timeReversed'));
}

function splitTime(beginMs: TimeMs, endMs: TimeMs, leftLength: number, totalLength: number): TimeMs {
  if (beginMs === null || endMs === null) return null;
  return beginMs + Math.round((endMs - beginMs) * leftLength / totalLength);
}

function editWord(document: LyricDocument, lineId: string, wordId: string, update: (word: LyricWord, line: LyricLine) => LyricWord[]): LyricDocument {
  let found = false;
  const lines = document.lines.map((line) => {
    if (line.id !== lineId) return line;
    const index = line.words.findIndex((word) => word.id === wordId);
    if (index < 0) throw new MessageError(message('command.wordMissing'));
    found = true;
    const words = line.words.slice();
    const replacement = update(words[index], line);
    if (replacement.length === 1 && replacement[0] === words[index]) return line;
    words.splice(index, 1, ...replacement);
    return { ...line, words };
  });
  if (!found) throw new MessageError(message('command.lineMissing'));
  return lines.every((line, index) => line === document.lines[index]) ? document : { ...document, lines };
}

function updateRuby(word: LyricWord, rubyId: string, update: (unit: RubyUnit) => RubyUnit[]): LyricWord {
  const index = word.rubyUnits.findIndex((unit) => unit.id === rubyId);
  if (index < 0) throw new MessageError(message('command.rubyMissing'));
  const units = word.rubyUnits.slice();
  const replacement = update(units[index]);
  if (replacement.length === 1 && replacement[0] === units[index]) return word;
  units.splice(index, 1, ...replacement);
  return { ...word, rubyUnits: units };
}

function lineIndex(document: LyricDocument, id: string): number {
  const index = document.lines.findIndex((line) => line.id === id);
  if (index < 0) throw new MessageError(message('command.lineMissing'));
  return index;
}

function afterLineGroup(lines: LyricLine[], id: string): number {
  const index = lines.findIndex((line) => line.id === id);
  if (index < 0) throw new MessageError(message('command.lineMissing'));
  const line = lines[index];
  if (line.backgroundOf) throw new MessageError(message('command.parentAnchor'));
  const background = lines.reduce((last,item,i)=>item.backgroundOf===id?i:last,-1);
  return Math.max(background,index);
}

function wordFitsLine(word: LyricWord, line: LyricLine) {
  validTime(word.beginMs, word.endMs);
  if (line.beginMs !== null && word.beginMs !== null && word.beginMs < line.beginMs || line.endMs !== null && word.endMs !== null && word.endMs > line.endMs) throw new MessageError(message('command.wordOutsideLine'));
}

/** Resolve every ID from the current document, then check document-order continuity. */
export function consecutive<T extends { id: string }>(siblings: T[], ids: string[]): T[] {
  const selected = siblings.filter(item => ids.includes(item.id));
  if (ids.length < 2 || new Set(ids).size !== ids.length || selected.length !== ids.length) throw new MessageError(message('command.mergeMinimum'));
  const start = siblings.indexOf(selected[0]);
  if (selected.some((item, index) => siblings[start + index] !== item)) throw new MessageError(message('command.mergeContinuous'));
  return selected;
}

export function timeEnvelope(units: { beginMs: TimeMs; endMs: TimeMs }[]) {
  const starts = units.flatMap(unit => unit.beginMs === null ? [] : [unit.beginMs]);
  const ends = units.flatMap(unit => unit.endMs === null ? [] : [unit.endMs]);
  const beginMs = starts.length ? Math.min(...starts) : null;
  const endMs = ends.length ? Math.max(...ends) : null;
  return { beginMs, endMs };
}

function rubyFitsWord(unit: RubyUnit, word: LyricWord) {
  validTime(unit.beginMs, unit.endMs);
  if (word.beginMs !== null && unit.beginMs !== null && unit.beginMs < word.beginMs || word.endMs !== null && unit.endMs !== null && unit.endMs > word.endMs) throw new MessageError(message('command.rubyOutsideWordAdjust'));
}

export function planWordMerge(document: LyricDocument, ids: string[]) {
  const owners = document.lines.filter(line => line.words.some(word => ids.includes(word.id)));
  if (owners.length !== 1) throw new MessageError(message('command.mergeSameLine'));
  const line = owners[0], words = consecutive(line.words, ids);
  const effective = wordAgents(document,line,words[0]);
  if(words.some(word=>!sameAgents(wordAgents(document,line,word),effective))) throw new MessageError(message('command.mergeSingers'));
  const explicit=words.some(word=>word.agentRefs);
  const merged = { ...words[0], ...(explicit ? {agentRefs:[...effective]} : {}), text: words.map(word => word.text).join(''), ...timeEnvelope(words),
    rubyUnits: words.flatMap(word => word.rubyUnits), obscene: words.some(word => word.obscene) };
  wordFitsLine(merged, line);
  merged.rubyUnits.forEach(unit => rubyFitsWord(unit, merged));
  return { line, words, merged };
}

export function planRubyMerge(document: LyricDocument, ids: string[]) {
  const owners = document.lines.flatMap(line => line.words.filter(word => word.rubyUnits.some(unit => ids.includes(unit.id))).map(word => ({ line, word })));
  if (owners.length !== 1) throw new MessageError(message('command.mergeSameWord'));
  const { line, word } = owners[0], units = consecutive(word.rubyUnits, ids);
  const merged = { ...units[0], reading: units.map(unit => unit.reading).join(''), ...timeEnvelope(units) };
  rubyFitsWord(merged, word);
  wordFitsLine({ ...word, ...timeEnvelope([word, merged]) }, line);
  return { line, word, units, merged };
}

export function planLineMerge(document: LyricDocument, ids: string[]) {
  const selected = consecutive(document.lines.filter(line => !line.backgroundOf), ids);
  const first = selected[0];
  const merged: LyricLine = { ...first, words: selected.flatMap(line => line.words),
    beginMs: selected.find(line => line.beginMs !== null)?.beginMs ?? null,
    endMs: [...selected].reverse().find(line => line.endMs !== null)?.endMs ?? null,
    agentRefs: [...(selected.find(line => line.agentRefs.length)?.agentRefs ?? [])],
    songPart: selected.find(line => line.songPart !== null && line.songPart !== '')?.songPart ?? null };
  validTime(merged.beginMs, merged.endMs);
  merged.words.forEach(word => { wordFitsLine(word, merged); word.rubyUnits.forEach(unit => rubyFitsWord(unit, word)); });
  return { selected, merged };
}

export type LineSplitPlan = {
  lineId: string;
  beforeWordIds: string[];
  newLineIds: string[];
  contentTargets: Record<string, number>;
  translationTargets: Record<string, number>;
  backgroundTargets: Record<string, number>;
};

/** The dialog and command share exact segment boundaries and validation. */
export function previewLineSplit(line: LyricLine, beforeWordIds: string[]) {
  const cuts = line.words.flatMap((word, index) => beforeWordIds.includes(word.id) ? [index] : []);
  if (!cuts.length || cuts[0] === 0 || cuts.length !== beforeWordIds.length) throw new MessageError(message('command.splitPoint'));
  const bounds = [0, ...cuts, line.words.length];
  return bounds.slice(0, -1).map((start, index) => {
    const words = line.words.slice(start, bounds[index + 1]);
    const envelope = timeEnvelope(words);
    const segment = { ...line, words, ...envelope };
    let issue: Message | null = null;
    try { validTime(segment.beginMs, segment.endMs); words.forEach(word => wordFitsLine(word, segment)); }
    catch { issue = message('split.invalidSegment',{number:index+1}); }
    return { segment, issue };
  });
}

function applyStructure(document: LyricDocument, command: AtomicLyricCommand, editing: ProjectEditing): LyricDocument | null {
  switch (command.type) {
    case 'sync-stamp': return stampSync(document, command.cursor, command.action, command.timeMs, command.mode, editing);
    case 'insert-line': {
      const line = command.line ?? createLine('');
      if (document.lines.some((item) => item.id === line.id)) throw new MessageError(message('command.lineDuplicate'));
      if (line.backgroundOf) throw new MessageError(message('command.insertBackgroundParent'));
      const after = command.afterLineId === null ? -1 : afterLineGroup(document.lines, command.afterLineId);
      const lines = document.lines.slice();
      lines.splice(after + 1, 0, line);
      return { ...document, lines };
    }
    case 'set-background-of': {
      const sourceIndex = lineIndex(document, command.lineId);
      const source = document.lines[sourceIndex];
      if (source.backgroundOf === command.parentLineId) return document;
      if (command.parentLineId === null) {
        const lines = document.lines.slice();
        lines[sourceIndex] = { ...source, agentRefs: [...lineAgents(document,source)], backgroundOf: null };
        return { ...document, lines };
      }
      const parent = document.lines[lineIndex(document, command.parentLineId)];
      if (source.id === parent.id || parent.backgroundOf) throw new MessageError(message('command.backgroundParent'));
      if (document.lines.some((line) => line.backgroundOf === source.id)) throw new MessageError(message('command.backgroundExists'));

      if (editing.endLinks[source.id] || Object.values(editing.endLinks).includes(source.id)) throw new MessageError(message('command.endLinkExists'));
      const lines = document.lines.filter((line) => line.id !== source.id);
      const parentIndex = afterLineGroup(lines, parent.id);
      lines.splice(parentIndex + 1, 0, { ...source, backgroundOf: parent.id, songPart: null });
      return { ...document, lines };
    }
    case 'delete-line': {
      lineIndex(document, command.lineId);
      const removed = new Set(document.lines.filter((line) => line.id === command.lineId || line.backgroundOf === command.lineId).map((line) => line.id));
      const lines = document.lines.filter(line => !removed.has(line.id));
      const romanizationTracks = document.romanizationTracks.map((track) => ({ ...track, contents: track.contents.filter((content) => !removed.has(content.lineId)) }));
      const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.filter(content => !removed.has(content.lineId)) }));
      return { ...document, lines, romanizationTracks, translationTracks };
    }
    case 'move-line': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.backgroundOf) throw new MessageError(message('command.moveBackgroundParent'));
      const group = document.lines.filter((item) => item.id === line.id || item.backgroundOf === line.id);
      const rest = document.lines.filter((item) => !group.includes(item));
      if (command.afterLineId !== null && group.some((item) => item.id === command.afterLineId)) throw new MessageError(message('command.moveLineSelf'));
      const after = command.afterLineId === null ? -1 : afterLineGroup(rest, command.afterLineId);
      rest.splice(after + 1, 0, ...group);
      return rest.every((item, i) => item === document.lines[i]) ? document : { ...document, lines: rest };
    }
    case 'split-line': {
      const index = lineIndex(document, command.lineId), line = document.lines[index];
      const issues = lineStructureIssues(document, line);
      if (issues.length) throw new MessageError(messageList(issues));
      const preview = previewLineSplit(line, command.beforeWordIds);
      const invalid = preview.flatMap(item => item.issue ? [item.issue] : []);
      if (invalid.length) throw new MessageError(messageList(invalid));
      if (command.newLineIds.length !== preview.length - 1 || new Set(command.newLineIds).size !== command.newLineIds.length || command.newLineIds.some(id => document.lines.some(item => item.id === id))) throw new MessageError(message('command.newLineId'));
      const segments = preview.map(({ segment }, i) => ({ ...segment, id: i ? command.newLineIds[i - 1] : line.id }));
      const assigned = (targets: Record<string, number>, contents: { id: string; lineId: string }[]) => {
        const attached = contents.filter(content => content.lineId === line.id);
        if (Object.keys(targets).some(id => !attached.some(content => content.id === id))) throw new MessageError(message('split.assignmentMissing'));
        if (attached.some(content => !Number.isInteger(targets[content.id]) || !segments[targets[content.id]])) throw new MessageError(message('split.assignmentStale'));
      };
      assigned(command.contentTargets, document.romanizationTracks.flatMap(track => track.contents));
      assigned(command.translationTargets, document.translationTracks.flatMap(track => track.contents));
      const backgrounds = document.lines.filter(item => item.backgroundOf === line.id);
      const target = (id: string) => command.backgroundTargets[id];
      if (Object.keys(command.backgroundTargets).some(id => !backgrounds.some(bg => bg.id === id))) throw new MessageError(message('command.backgroundAssignmentMissing'));
      if (backgrounds.some(bg => target(bg.id) === null || !Number.isInteger(target(bg.id)) || !segments[target(bg.id)!])) throw new MessageError(message('command.backgroundReassign'));
      for (const [id, target] of Object.entries(editing.endLinks)) if (target === line.id && segments[0].beginMs !== line.beginMs) delete editing.endLinks[id];
      const outgoing = editing.endLinks[line.id];
      delete editing.endLinks[line.id];
      if (outgoing && segments.at(-1)!.endMs === line.endMs) editing.endLinks[segments.at(-1)!.id] = outgoing;
      if (editing.skippedAlignmentLineIds.includes(line.id)) editing.skippedAlignmentLineIds.push(...command.newLineIds);
      if (editing.ignoredSyncLineIds.includes(line.id)) editing.ignoredSyncLineIds.push(...command.newLineIds);
      const lines = document.lines.filter(item => !backgrounds.includes(item));
      lines.splice(index, 1, ...segments.flatMap((segment, i) => [segment, ...backgrounds.filter(bg=>target(bg.id)===i).map(bg=>({...bg,backgroundOf:segment.id}))]));
      const romanizationTracks = document.romanizationTracks.map(track => ({ ...track, contents: track.contents.map(content => content.lineId === line.id ? { ...content, lineId: segments[command.contentTargets[content.id]].id } : content) }));
      const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.map(content => content.lineId === line.id ? { ...content, lineId: segments[command.translationTargets[content.id]].id } : content) }));
      return { ...document, lines, romanizationTracks, translationTracks };
    }
    case 'merge-lines': {
      const { selected, merged } = planLineMerge(document, command.lineIds);
      const ids = new Set(selected.map(line => line.id));
      // Skip-alignment is an all-lines flag; ignore-sync retains the first line's flag.
      if (!selected.every(line => editing.skippedAlignmentLineIds.includes(line.id))) editing.skippedAlignmentLineIds = editing.skippedAlignmentLineIds.filter(id => id !== merged.id);
      const outgoing = editing.endLinks[selected.at(-1)!.id];
      for (const [source, target] of Object.entries(editing.endLinks)) if (ids.has(source) || ids.has(target) && target !== merged.id) delete editing.endLinks[source];
      if (outgoing && !ids.has(outgoing)) editing.endLinks[merged.id] = outgoing;
      const backgrounds = document.lines.filter(line => line.backgroundOf && ids.has(line.backgroundOf)).map(line => ({ ...line, backgroundOf: merged.id }));
      const lines = document.lines.flatMap(line => line.id === merged.id ? [merged, ...backgrounds] : ids.has(line.id) || line.backgroundOf && ids.has(line.backgroundOf) ? [] : [line]);
      const migrate = <T extends { contents: RomanizationContent[] }>(tracks: T[]): T[] => tracks.map(track => {
        const moved = selected.flatMap(line => track.contents.filter(content => content.lineId === line.id).map(content => ({ ...content, lineId: merged.id })));
        const firstIndex = track.contents.findIndex(content => ids.has(content.lineId));
        if (firstIndex < 0) return track;
        const contents = track.contents.filter(content => !ids.has(content.lineId));
        contents.splice(firstIndex, 0, ...moved);
        return { ...track, contents };
      });
      return { ...document, lines, romanizationTracks: migrate(document.romanizationTracks), translationTracks: migrate(document.translationTracks) };
    }
    case 'set-song-part': {
      if (command.lineIds.some(id => !document.lines.some(line => line.id === id && !line.backgroundOf))) throw new MessageError(message('command.leadParagraph'));
      const value = command.value?.trim() ? command.value : null;
      const lines = document.lines.map(line => command.lineIds.includes(line.id) && line.songPart !== value ? { ...line, songPart: value } : line);
      return lines.every((line, i) => line === document.lines[i]) ? document : { ...document, lines };
    }
    case 'insert-word': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (document.lines.some((item) => item.words.some((word) => word.id === command.word.id))) throw new MessageError(message('command.wordDuplicate'));
      if (!command.word.text) throw new MessageError(message('command.wordTextEmpty'));
      wordFitsLine(command.word, line);
      const after = command.afterWordId === null ? -1 : line.words.findIndex((word) => word.id === command.afterWordId);
      if (command.afterWordId !== null && after < 0) throw new MessageError(message('command.wordMissing'));
      const words = line.words.slice();
      words.splice(after + 1, 0, command.word);
      const lines = document.lines.slice();
      lines[index] = { ...line, words };
      return { ...document, lines };
    }
    case 'delete-word': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (!line.words.some((word) => word.id === command.wordId)) throw new MessageError(message('command.wordMissing'));
      const lines = document.lines.slice();
      lines[index] = { ...line, words: line.words.filter((word) => word.id !== command.wordId) };
      return { ...document, lines };
    }
    case 'segment-word':
      return editWord(document, command.lineId, command.wordId, (word, line) => {
        if (command.words.length < 2 || command.words.map((part) => part.text).join('') !== word.text || command.words[0].id !== word.id) throw new MessageError(message('command.segmentText'));
        if (word.rubyUnits.length || word.obscene || emptyBeatCount(editing, word.id)) throw new MessageError(message('command.segmentAttributes'));
        const ids = command.words.map((part) => part.id);
        if (new Set(ids).size !== ids.length || ids.slice(1).some((id) => document.lines.some((item) => item.words.some((part) => part.id === id)))) throw new MessageError(message('command.segmentIds'));
        for (const part of command.words) {
          if (!part.text || part.rubyUnits.length || part.obscene || emptyBeatCount(editing, part.id)) throw new MessageError(message('command.segmentNewAttributes'));
          wordFitsLine(part, line);
        }
        if (command.words[0].beginMs !== word.beginMs || command.words.at(-1)?.endMs !== word.endMs) throw new MessageError(message('command.segmentInterval'));
        return command.words.map(part=>({...part,...(word.agentRefs?{agentRefs:[...word.agentRefs]}:{})}));
      });
    case 'segment-words': {
      if (!command.changes.length) return document;
      const changes = new Map(command.changes.map((change) => [change.wordId, change]));
      if (changes.size !== command.changes.length) throw new MessageError(message('command.segmentDuplicate'));
      const originalIds = new Set(document.lines.flatMap((line) => line.words.map((word) => word.id)));
      const generatedIds = new Set<string>();
      let applied = 0;
      const lines = document.lines.map((line) => {
        if (!line.words.some((word) => changes.has(word.id))) return line;
        const words = line.words.flatMap((word) => {
          const change = changes.get(word.id);
          if (!change) return [word];
          if (change.lineId !== line.id || change.words.length < 2 || change.words[0].id !== word.id || change.words.map((part) => part.text).join('') !== word.text) throw new MessageError(message('command.segmentMismatch'));
          if (word.rubyUnits.length || word.obscene || emptyBeatCount(editing, word.id)) throw new MessageError(message('command.segmentAttributes'));
          if (change.words[0].beginMs !== word.beginMs || change.words.at(-1)?.endMs !== word.endMs) throw new MessageError(message('command.segmentInterval'));
          for (const [index, part] of change.words.entries()) {
            if (!part.text || part.rubyUnits.length || part.obscene || emptyBeatCount(editing, part.id)) throw new MessageError(message('command.segmentNewAttributes'));
            if (generatedIds.has(part.id) || index > 0 && originalIds.has(part.id)) throw new MessageError(message('command.segmentIds'));
            generatedIds.add(part.id);
            wordFitsLine(part, line);
          }
          applied++;
          return change.words.map(part=>({...part,...(word.agentRefs?{agentRefs:[...word.agentRefs]}:{})}));
        });
        return { ...line, words };
      });
      if (applied !== changes.size) throw new MessageError(message('command.segmentMissing'));
      return { ...document, lines };
    }
    case 'merge-words': {
      const { line, words: selected, merged } = planWordMerge(document, command.wordIds);
      const ids = new Set(command.wordIds);
      const words = line.words.flatMap(word => word.id === selected[0].id ? [merged] : ids.has(word.id) ? [] : [word]);
      return { ...document, lines: document.lines.map(item => item === line ? { ...line, words } : item) };
    }
    case 'merge-ruby': {
      const { line, word, units, merged } = planRubyMerge(document, command.rubyIds);
      const ids = new Set(command.rubyIds);
      return editWord(document, line.id, word.id, () => [{ ...word, rubyUnits: word.rubyUnits.flatMap(unit => unit.id === units[0].id ? [merged] : ids.has(unit.id) ? [] : [unit]) }]);
    }
    case 'move-word': {
      const fromIndex = lineIndex(document, command.lineId);
      const toIndex = lineIndex(document, command.toLineId);
      const from = document.lines[fromIndex];
      const to = document.lines[toIndex];
      const word = from.words.find((item) => item.id === command.wordId);
      if (!word) throw new MessageError(message('command.wordMissing'));
      if (command.afterWordId === word.id) throw new MessageError(message('command.moveWordSelf'));
      wordFitsLine(word, to);
      const destination = to.words.filter((item) => item.id !== word.id);
      const after = command.afterWordId === null ? -1 : destination.findIndex((item) => item.id === command.afterWordId);
      if (command.afterWordId !== null && after < 0) throw new MessageError(message('command.wordMissing'));
      destination.splice(after + 1, 0, preserveWordAgents(document,from,to,word));
      const lines = document.lines.slice();
      if (fromIndex === toIndex) {
        if (destination.every((item, index) => item === from.words[index])) return document;
        lines[fromIndex] = { ...from, words: destination };
      } else {
        lines[fromIndex] = { ...from, words: from.words.filter((item) => item.id !== word.id) };
        lines[toIndex] = { ...to, words: destination };
      }
      return { ...document, lines };
    }
    case 'set-line-time': {
      validTime(command.beginMs, command.endMs);
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.words.some((word) => command.beginMs !== null && word.beginMs !== null && word.beginMs < command.beginMs || command.endMs !== null && word.endMs !== null && word.endMs > command.endMs)) throw new MessageError(message('command.lineExcludesWord'));
      if (line.beginMs === command.beginMs && line.endMs === command.endMs) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, beginMs: command.beginMs, endMs: command.endMs };
      if (line.endMs !== command.endMs) delete editing.endLinks[line.id];
      for (let linkedIndex = 0; linkedIndex < lines.length; linkedIndex++) {
        const linked = lines[linkedIndex];
        if (editing.endLinks[linked.id] !== line.id) continue;
        const linkedEnd = command.beginMs;
        if (linkedEnd === null || linked.words.some((word) => word.endMs !== null && word.endMs > linkedEnd)) throw new MessageError(message('command.linkBeforeWordsEnglish'));
        validTime(linked.beginMs, linkedEnd);
        lines[linkedIndex] = { ...linked, endMs: linkedEnd };
      }
      return { ...document, lines };
    }
    case 'link-line-end': {
      const index = lineIndex(document, command.lineId);
      const target = document.lines[lineIndex(document, command.targetLineId)];
      const line = document.lines[index];
      if (line.id === target.id || line.backgroundOf || target.backgroundOf || target.beginMs === null) throw new MessageError(message('command.linkTarget'));
      const targetBegin = target.beginMs;
      if (line.words.some((word) => word.endMs !== null && word.endMs > targetBegin)) throw new MessageError(message('command.linkBeforeWords'));
      validTime(line.beginMs, targetBegin);
      if (editing.endLinks[line.id] === target.id) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, endMs: targetBegin };
      editing.endLinks[line.id] = target.id;
      return { ...document, lines };
    }
    case 'unlink-line-end': {
      lineIndex(document, command.lineId);
      delete editing.endLinks[command.lineId];
      return document;
    }
    case 'set-line-agents': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (command.agentRefs.some((ref) => !document.agents.some((agent) => agent.id === ref))) throw new MessageError(message('command.unknownSinger'));
      const lines = document.lines.slice();
      lines[index] = { ...line, agentRefs: command.agentRefs };
      return { ...document, lines };
    }
    case 'set-skip-alignment': {
      lineIndex(document, command.lineId);
      editing.skippedAlignmentLineIds = editing.skippedAlignmentLineIds.filter(id => id !== command.lineId);
      if (command.skip) editing.skippedAlignmentLineIds.push(command.lineId);
      return document;
    }
    case 'set-ignore-sync': {
      lineIndex(document, command.lineId);
      editing.ignoredSyncLineIds = editing.ignoredSyncLineIds.filter(id => id !== command.lineId);
      if (command.ignoreSync) editing.ignoredSyncLineIds.push(command.lineId);
      return document;
    }
    case 'set-empty-beat': {
      const exists = document.lines.some(line => line.words.some(word => command.kind === 'word' ? word.id === command.id : word.rubyUnits.some(unit => unit.id === command.id)));
      if (!exists) throw new MessageError(message('command.beatMissing'));
      setEmptyBeat(editing, command.id, command.kind, command.count);
      return document;
    }
    case 'restore-editing':
      Object.assign(editing.emptyBeats, command.editing.emptyBeats);
      editing.skippedAlignmentLineIds = [...new Set([...editing.skippedAlignmentLineIds, ...command.editing.skippedAlignmentLineIds])];
      editing.ignoredSyncLineIds = [...new Set([...editing.ignoredSyncLineIds, ...command.editing.ignoredSyncLineIds])];
      Object.assign(editing.endLinks, command.editing.endLinks);
      return document;
    case 'set-translation-tracks': {
      if (command.source !== document.translationTracks) throw new MessageError(message('command.translationChanged'));
      validateTranslationTracks(command.tracks, new Set(document.lines.map(line => line.id)));
      return JSON.stringify(command.tracks) === JSON.stringify(document.translationTracks) ? document : { ...document, translationTracks: command.tracks };
    }
    case 'insert-translation-content': {
      if (!document.translationTracks.some(track => track.id === command.trackId)) throw new MessageError(message('command.translationTrackMissing'));
      const translationTracks = document.translationTracks.map(track => track.id !== command.trackId ? track : { ...track, contents: [...track.contents, command.content] });
      validateTranslationTracks(translationTracks, new Set(document.lines.map(line => line.id)));
      return { ...document, translationTracks };
    }
    case 'add-romanization-track':
      if (document.romanizationTracks.some((track) => track.id === command.track.id)) throw new MessageError(message('command.romanizationTrackDuplicate'));
      if (command.track.contents.length) throw new MessageError(message('command.newTrackNotEmpty'));
      return { ...document, romanizationTracks: [...document.romanizationTracks, command.track] };
    case 'delete-romanization-track':
      if (!document.romanizationTracks.some((track) => track.id === command.trackId)) throw new MessageError(message('command.romanizationTrackMissing'));
      return { ...document, romanizationTracks: document.romanizationTracks.filter((track) => track.id !== command.trackId) };
    case 'set-romanization-track-language': {
      if (command.language !== null && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(command.language)) throw new MessageError(message('command.romanizationLanguage'));
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new MessageError(message('command.romanizationTrackMissing'));
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...romanizationTracks[index], language: command.language };
      return { ...document, romanizationTracks };
    }
    case 'move-romanization-track': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new MessageError(message('command.romanizationTrackMissing'));
      const target = index + command.direction;
      if (target < 0 || target >= document.romanizationTracks.length) return document;
      const romanizationTracks = document.romanizationTracks.slice();
      [romanizationTracks[index], romanizationTracks[target]] = [romanizationTracks[target], romanizationTracks[index]];
      return { ...document, romanizationTracks };
    }
    case 'insert-romanization-content':
    case 'set-romanization-content':
    case 'delete-romanization-content': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new MessageError(message('command.romanizationTrackMissing'));
      const track = document.romanizationTracks[index];
      const contentIndex = track.contents.findIndex((content) => content.id === (command.type === 'delete-romanization-content' ? command.contentId : command.content.id));
      let contents: RomanizationContent[];
      if (command.type === 'insert-romanization-content') {
        if (document.romanizationTracks.some((item) => item.contents.some((content) => content.id === command.content.id))) throw new MessageError(message('command.romanizationContentDuplicate'));
        if (!document.lines.some((line) => line.id === command.content.lineId)) throw new MessageError(message('command.romanizationLineMissing'));
        if (command.content.kind === 'timed') {
          if (new Set(command.content.units.map((unit) => unit.id)).size !== command.content.units.length) throw new MessageError(message('command.romanizationUnitDuplicate'));
          command.content.units.forEach((unit) => validTime(unit.beginMs, unit.endMs));
        }
        contents = [...track.contents, command.content];
      } else {
        if (contentIndex < 0) throw new MessageError(message('command.romanizationContentMissing'));
        if (command.type === 'set-romanization-content') {
          if (!document.lines.some((line) => line.id === command.content.lineId)) throw new MessageError(message('command.romanizationLineMissing'));
          if (command.content.kind === 'timed') {
            if (new Set(command.content.units.map((unit) => unit.id)).size !== command.content.units.length) throw new MessageError(message('command.romanizationUnitDuplicate'));
            command.content.units.forEach((unit) => validTime(unit.beginMs, unit.endMs));
          }
          contents = track.contents.slice(); contents[contentIndex] = command.content;
        } else contents = track.contents.filter((content) => content.id !== command.contentId);
      }
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'move-romanization-content': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new MessageError(message('command.romanizationTrackMissing'));
      if (!document.lines.some((line) => line.id === command.lineId)) throw new MessageError(message('command.romanizationLineMissing'));
      const track = document.romanizationTracks[index];
      const content = track.contents.find((item) => item.id === command.contentId);
      if (!content) throw new MessageError(message('command.romanizationContentMissing'));
      const contents = track.contents.filter((item) => item.id !== command.contentId);
      const after = command.afterContentId === null ? -1 : contents.findIndex((item) => item.id === command.afterContentId);
      if (command.afterContentId !== null && after < 0) throw new MessageError(message('command.romanizationPositionMissing'));
      contents.splice(after + 1, 0, { ...content, lineId: command.lineId });
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'split-romanization-unit':
    case 'move-romanization-unit': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new MessageError(message('command.romanizationTrackMissing'));
      const track = document.romanizationTracks[index];
      const contentIndex = track.contents.findIndex((content) => content.id === command.contentId);
      const content = track.contents[contentIndex];
      if (!content || content.kind !== 'timed') throw new MessageError(message('command.timedRomanization'));
      const units = content.units.slice();
      if (command.type === 'split-romanization-unit') {
        const unitIndex = units.findIndex((unit) => unit.id === command.unitId);
        if (unitIndex < 0) throw new MessageError(message('command.romanizationUnitMissing'));
        const unit = units[unitIndex];
        const [left, right] = splitAtGrapheme(unit.text, command.at);
        const middle = splitTime(unit.beginMs, unit.endMs, Array.from(left).length, Array.from(unit.text).length);
        units.splice(unitIndex, 1, { ...unit, text: left, endMs: middle }, { id: crypto.randomUUID(), text: right, beginMs: middle, endMs: unit.endMs });
      } else {
        const unitIndex = units.findIndex((unit) => unit.id === command.unitId);
        if (unitIndex < 0) throw new MessageError(message('command.romanizationUnitMissing'));
        const [unit] = units.splice(unitIndex, 1);
        const after = command.afterUnitId === null ? -1 : units.findIndex((item) => item.id === command.afterUnitId);
        if (command.afterUnitId !== null && after < 0) throw new MessageError(message('command.romanizationPositionMissing'));
        units.splice(after + 1, 0, unit);
      }
      const contents = track.contents.slice();
      contents[contentIndex] = { ...content, units };
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'set-metadata': {
      if (!/^[A-Za-z][\w.-]*$/.test(command.key)) throw new MessageError(message('parse.metadataName',{key:command.key}));
      const metadata = { ...document.metadata };
      if (command.values.length) metadata[command.key] = command.values;
      else delete metadata[command.key];
      return { ...document, metadata };
    }
    case 'set-language':
      if (command.language !== null && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(command.language)) throw new MessageError(message('command.languageInvalid'));
      return { ...document, language: command.language };
    case 'rename-metadata': {
      if (!Object.hasOwn(document.metadata, command.key)) throw new MessageError(message('command.metadataMissing'));
      if (command.key === command.nextKey) return document;
      if (!/^[A-Za-z][\w.-]*$/.test(command.nextKey) || Object.hasOwn(document.metadata, command.nextKey)) throw new MessageError(message('command.metadataInvalid'));
      return { ...document, metadata: Object.fromEntries(Object.entries(document.metadata).map(([key, values]) => [key === command.key ? command.nextKey : key, values])) };
    }
    case 'rename-agent': {
      if (!document.agents.some(a => a.id === command.id)) throw new MessageError(message('command.singerMissing'));
      if (command.id === command.nextId) return document;
      if (!/^[A-Za-z_][\w.-]*$/.test(command.nextId) || document.agents.some(a => a.id === command.nextId)) throw new MessageError(message('command.singerId'));
      return { ...document, agents: document.agents.map(a => ({ ...a, id: a.id === command.id ? command.nextId : a.id, ...(a.actorRef === command.id ? { actorRef: command.nextId } : {}) })), lines: document.lines.map(l => ({ ...l, agentRefs: l.agentRefs.map(id => id === command.id ? command.nextId : id), words:l.words.map(w=>w.agentRefs?{...w,agentRefs:w.agentRefs.map(id=>id===command.id?command.nextId:id)}:w) })) };
    }
    case 'delete-agent': {
      if (!document.agents.some(a => a.id === command.id)) throw new MessageError(message('command.singerMissing'));
      return { ...document, agents: document.agents.filter(a => a.id !== command.id).map(a => { if (a.actorRef !== command.id) return a; const { actorRef: _, ...rest } = a; return rest; }), lines: document.lines.map(l => ({ ...l, agentRefs: l.agentRefs.filter(id => id !== command.id), words:l.words.map(w=>{if(!w.agentRefs)return w;const next: LyricWord={...w,agentRefs:w.agentRefs.filter(id=>id!==command.id)};if(!next.agentRefs!.length)delete next.agentRefs;return next;}) })) };
    }
    case 'set-agents':
      if (command.agents.some(a => a.actorRef !== undefined && !command.agents.some(target => target.id === a.actorRef))) throw new MessageError(message('command.actorUnknown'));
      if (command.agents.some((agent) => !/^[A-Za-z_][\w.-]*$/.test(agent.id)) || new Set(command.agents.map((agent) => agent.id)).size !== command.agents.length) throw new MessageError(message('command.agentInvalid'));
      if (document.lines.some((line) => [...line.agentRefs,...line.words.flatMap(word=>word.agentRefs??[])].some((ref) => !command.agents.some((agent) => agent.id === ref)))) throw new MessageError(message('command.assignedSinger'));
      return { ...document, agents: command.agents };
    case 'move-ruby': {
      const line = document.lines.find(line => line.id === command.lineId);
      const source = line?.words.find(word => word.id === command.wordId);
      const target = line?.words.find(word => word.id === (command.toWordId ?? command.wordId));
      if (!line || !source || !target) throw new MessageError(message('command.readingSameLine'));
      const ids = new Set(command.rubyIds ?? [command.rubyId]);
      const units = source.rubyUnits.filter(unit => ids.has(unit.id));
      if (!ids.has(command.rubyId) || !units.length || units.length !== ids.size) throw new MessageError(message('command.readingMissing'));
      if (source === target && command.afterRubyId !== null && ids.has(command.afterRubyId)) return document;
      const remaining = target.rubyUnits.filter(unit => source !== target || !ids.has(unit.id));
      const after = command.afterRubyId === null ? -1 : remaining.findIndex(unit => unit.id === command.afterRubyId);
      if (command.afterRubyId !== null && after < 0) throw new MessageError(message('command.readingPositionMissing'));
      remaining.splice(after + 1, 0, ...units);
      if (source === target && remaining.every((unit, index) => unit === source.rubyUnits[index])) return document;
      const words = line.words.map(word => word === target ? { ...word, rubyUnits: remaining }
        : word === source ? { ...word, rubyUnits: word.rubyUnits.filter(unit => !ids.has(unit.id)) } : word);
      return { ...document, lines: document.lines.map(item => item === line ? { ...line, words } : item) };
    }
    case 'replace-document':
      if (command.editing) Object.assign(editing, structuredClone(command.editing));
      return command.document;
    default:
      return null;
  }
}

function applyAtomic(document: LyricDocument, command: AtomicLyricCommand, editing: ProjectEditing): LyricDocument {
  if (command.type === 'shift-lines') return (shiftLineTimes(document, command.lineIds, command.deltaMs, editing) as Extract<LyricCommand, {type:'replace-document'}>).document;
  const structured = applyStructure(document, command, editing);
  const wordCommand = command as WordCommand;
  return structured ?? editWord(document, wordCommand.lineId, wordCommand.wordId, (word, line) => {
    switch (wordCommand.type) {
      case 'split-word': {
        if (word.rubyUnits.length) throw new MessageError(message('command.splitReadingFirst'));
        if (word.obscene || emptyBeatCount(editing, word.id)) throw new MessageError(message('command.splitAttributes'));
        const [left, right] = splitAtGrapheme(word.text, wordCommand.at);
        const newId = wordCommand.newWordId ?? crypto.randomUUID();
        if (line.words.some((item) => item.id === newId)) throw new MessageError(message('command.wordIdExists'));
        const middle = splitTime(word.beginMs, word.endMs, Array.from(left).length, Array.from(word.text).length);
        return [
          { ...word, text: left, endMs: middle },
          { ...word, id:newId, text:right, beginMs: middle, endMs: word.endMs },
        ];
      }
      case 'set-word-agents': {
        const next = {...word};
        if(wordCommand.agentRefs.length) next.agentRefs=[...wordCommand.agentRefs]; else delete next.agentRefs;
        return JSON.stringify(next)===JSON.stringify(word)?[word]:[next];
      }
      case 'set-word-obscene':
        return [word.obscene === wordCommand.obscene ? word : { ...word, obscene: wordCommand.obscene }];
      case 'edit-word':
        if (!wordCommand.text) throw new MessageError(message('command.wordTextEmpty'));
        return [wordCommand.text === word.text ? word : { ...word, text: wordCommand.text }];
      case 'set-word-time':
        validTime(wordCommand.beginMs, wordCommand.endMs);
        if (line.beginMs !== null && wordCommand.beginMs !== null && wordCommand.beginMs < line.beginMs) throw new MessageError(message('command.wordBeforeLine'));
        if (line.endMs !== null && wordCommand.endMs !== null && wordCommand.endMs > line.endMs) throw new MessageError(message('command.wordAfterLine'));
        if (word.rubyUnits.some((unit) => wordCommand.beginMs !== null && unit.beginMs !== null && unit.beginMs < wordCommand.beginMs || wordCommand.endMs !== null && unit.endMs !== null && unit.endMs > wordCommand.endMs)) throw new MessageError(message('command.rubyOutsideWord'));
        return [word.beginMs === wordCommand.beginMs && word.endMs === wordCommand.endMs ? word : { ...word, beginMs: wordCommand.beginMs, endMs: wordCommand.endMs }];
      case 'add-ruby': {
        if (!wordCommand.reading) throw new MessageError(message('command.rubyEmpty'));
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new MessageError(message('command.rubyDuplicate'));
        return [{ ...word, rubyUnits: [...word.rubyUnits, { id, reading: wordCommand.reading, beginMs: null, endMs: null }] }];
      }
      case 'insert-ruby': {
        if (!wordCommand.reading) throw new MessageError(message('command.rubyEmpty'));
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new MessageError(message('command.rubyDuplicate'));
        const after = wordCommand.afterRubyId === null ? -1 : word.rubyUnits.findIndex((unit) => unit.id === wordCommand.afterRubyId);
        if (wordCommand.afterRubyId !== null && after < 0) throw new MessageError(message('command.rubyPositionMissing'));
        const rubyUnits = word.rubyUnits.slice();
        rubyUnits.splice(after + 1, 0, { id, reading: wordCommand.reading, beginMs: null, endMs: null });
        return [{ ...word, rubyUnits }];
      }
      case 'set-ruby-units': {
        if (word.rubyUnits.length && !wordCommand.overwrite) throw new MessageError(message('command.rubyOverwrite'));
        if (!wordCommand.units.length || wordCommand.units.some((unit) => !unit.reading)) throw new MessageError(message('command.rubyEmpty'));
        if (new Set(wordCommand.units.map((unit) => unit.id)).size !== wordCommand.units.length) throw new MessageError(message('command.rubyDuplicate'));
        for (const unit of wordCommand.units) {
          validTime(unit.beginMs, unit.endMs);
          if (word.beginMs !== null && unit.beginMs !== null && unit.beginMs < word.beginMs || word.endMs !== null && unit.endMs !== null && unit.endMs > word.endMs) throw new MessageError(message('command.rubyTimeOutside'));
        }
        return [{ ...word, rubyUnits: wordCommand.units }];
      }
      case 'redistribute-ruby-time': {
        const rubyUnits=distributeRubyTime(word,word.rubyUnits);
        return JSON.stringify(rubyUnits)===JSON.stringify(word.rubyUnits)?[word]:[{...word,rubyUnits}];
      }
      case 'set-word-empty-beat':
        setEmptyBeat(editing, word.id, 'word', wordCommand.emptyBeat);
        return [word];
      case 'split-ruby':
        return [updateRuby(word, wordCommand.rubyId, (unit) => {
            const [left, right] = splitAtGrapheme(unit.reading, wordCommand.at);
          const id = wordCommand.newRubyId ?? crypto.randomUUID();
          if (word.rubyUnits.some((item) => item.id === id)) throw new MessageError(message('command.rubyDuplicate'));
          const middle = isKanaReading(unit.reading)
            ? splitTime(unit.beginMs, unit.endMs, splitReadingMora(left).length, splitReadingMora(unit.reading).length)
            : splitTime(unit.beginMs, unit.endMs, 1, 2);
          return [{ ...unit, reading: left, endMs: middle }, { id, reading: right, beginMs: middle, endMs: unit.endMs }];
        })];
      case 'edit-ruby': {
        if (!wordCommand.reading) throw new MessageError(message('command.rubyEmpty'));
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => wordCommand.reading === unit.reading ? [unit] : [{ ...unit, reading: wordCommand.reading }]);
        return [updated];
      }
      case 'delete-ruby':
        delete editing.emptyBeats[wordCommand.rubyId];
        return [{ ...updateRuby(word, wordCommand.rubyId, () => []) }];
      case 'set-ruby-time': {
        validTime(wordCommand.beginMs, wordCommand.endMs);
        if (word.beginMs !== null && wordCommand.beginMs !== null && wordCommand.beginMs < word.beginMs || word.endMs !== null && wordCommand.endMs !== null && wordCommand.endMs > word.endMs) throw new MessageError(message('command.rubyTimeOutside'));
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => unit.beginMs === wordCommand.beginMs && unit.endMs === wordCommand.endMs ? [unit] : [{ ...unit, beginMs: wordCommand.beginMs, endMs: wordCommand.endMs }]);
        if (updated === word) return [word];
        const beginMs = word.beginMs ?? (updated.rubyUnits.every((unit) => unit.beginMs !== null) ? Math.min(...updated.rubyUnits.map((unit) => unit.beginMs!)) : null);
        const endMs = word.endMs ?? (updated.rubyUnits.every((unit) => unit.endMs !== null) ? Math.max(...updated.rubyUnits.map((unit) => unit.endMs!)) : null);
        return [{ ...updated, beginMs, endMs }];
      }
    }
  });
}

export function applyLyricTransaction(document: LyricDocument, command: LyricCommand, original: ProjectEditing) {
  const editing = structuredClone(original);
  const atomic = (before: LyricDocument, command: AtomicLyricCommand) => {
    const after = applyAtomic(before, command, editing);
    return after;
  };
  const lyrics = command.type === 'batch' ? command.commands.reduce(atomic, document) : atomic(document, command);
  reconcileEditing(document, lyrics, editing);
  validateProjectEditing(lyrics, editing);
  validateAgents(lyrics);
  return { lyrics, editing: JSON.stringify(editing) === JSON.stringify(original) ? original : editing };
}

export function applyLyricCommand(document: LyricDocument, command: LyricCommand, editing = createProjectEditing()): LyricDocument {
  return applyLyricTransaction(document, command, editing).lyrics;
}
