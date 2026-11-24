import {displayLines} from './amll-compatibility';
import { message, MessageError } from './messages';
import { timeEnvelope } from './lyric-commands';
import { createProjectEditing, type ProjectEditing } from './project-editing';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit } from './lyric-document';

export type SyncCursor = { lineId: string; wordId: string; rubyUnitId: string | null };
export type SyncMode = 'continuous' | 'line';
export type SyncAction = 'start' | 'next' | 'end';

export function syncUnits(document: LyricDocument, editing = createProjectEditing(), selectedLineId?: string, lineOrder: string[] = [], allLines = false): SyncCursor[] {
  return displayLines(document, lineOrder).filter(line => selectedLineId ? line.id === selectedLineId : allLines || !editing.ignoredSyncLineIds.includes(line.id)).flatMap(line =>
    line.words.flatMap((word): SyncCursor[] => word.rubyUnits.length
      ? word.rubyUnits.filter(unit => unit.reading.trim().length > 0).map(unit => ({ lineId: line.id, wordId: word.id, rubyUnitId: unit.id }))
      : word.text.trim().length > 0 ? [{ lineId: line.id, wordId: word.id, rubyUnitId: null }] : []));
}

export function syncIndex(units: SyncCursor[], cursor: SyncCursor | null): number {
  return cursor ? units.findIndex((unit) => unit.lineId === cursor.lineId && unit.wordId === cursor.wordId && unit.rubyUnitId === cursor.rubyUnitId) : -1;
}

function assign(word: LyricWord, rubyUnitId: string | null, side: 'beginMs' | 'endMs', timeMs: number): LyricWord {
  if (!rubyUnitId) {
    const other = side === 'beginMs' ? 'endMs' : 'beginMs';
    return { ...word, [side]: timeMs, [other]: word[other] !== null && (side === 'beginMs' ? word[other] < timeMs : word[other] > timeMs) ? null : word[other] };
  }
  const index = word.rubyUnits.findIndex((unit) => unit.id === rubyUnitId);
  if (index < 0) throw new MessageError(message('sync.rubyMissing'));
  const rubyUnits = word.rubyUnits.slice();
  const unit = rubyUnits[index];
  const other = side === 'beginMs' ? 'endMs' : 'beginMs';
  rubyUnits[index] = { ...unit, [side]: timeMs, [other]: unit[other] !== null && (side === 'beginMs' ? unit[other] < timeMs : unit[other] > timeMs) ? null : unit[other] } as RubyUnit;
  return { ...word, rubyUnits, ...timeEnvelope(rubyUnits) };
}

function updateUnit(line: LyricLine, cursor: SyncCursor, side: 'beginMs' | 'endMs', timeMs: number): LyricLine {
  const index = line.words.findIndex((word) => word.id === cursor.wordId);
  if (index < 0) throw new MessageError(message('sync.wordMissing'));
  const words = line.words.slice();
  words[index] = assign(words[index], cursor.rubyUnitId, side, timeMs);
  return { ...line, words, ...timeEnvelope([...words, line]) };
}

export function stampSync(document: LyricDocument, cursor: SyncCursor, action: SyncAction, timeMs: number, mode: SyncMode = 'continuous', editing = createProjectEditing(), lineOrder: string[] = []): LyricDocument {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0) throw new MessageError(message('sync.integerTime'));
  const local = mode === 'line' || editing.ignoredSyncLineIds.includes(cursor.lineId);
  const units = syncUnits(document, editing, local ? cursor.lineId : undefined, lineOrder);
  const index = syncIndex(units, cursor);
  if (index < 0) throw new MessageError(message('sync.cursorStale'));
  const current = units[index];
  const successor = units[index + 1];
  const next = action === 'next' && (mode === 'continuous' || successor?.lineId === current.lineId) ? successor : null;
  const changes = new Map<string, LyricLine>();
  const read = (id: string) => changes.get(id) ?? document.lines.find((line) => line.id === id)!;
  if (action === 'start') changes.set(current.lineId, updateUnit(read(current.lineId), current, 'beginMs', timeMs));
  else {
    const original = read(current.lineId).words.find((word) => word.id === current.wordId)!;
    const begin = current.rubyUnitId ? original.rubyUnits.find((unit) => unit.id === current.rubyUnitId)!.beginMs : original.beginMs;
    if (begin === null) throw new MessageError(message('sync.startFirst'));
    if (timeMs < begin) throw new MessageError(message('sync.endBeforeStart'));
    changes.set(current.lineId, updateUnit(read(current.lineId), current, 'endMs', timeMs));
    if (next) changes.set(next.lineId, updateUnit(read(next.lineId), next, 'beginMs', timeMs));
  }
  const lines = document.lines.map((line) => changes.get(line.id) ?? line);
  return { ...document, lines };
}
