import { message, MessageError } from './messages';
import type { LyricDocument } from './lyric-document';

/** Project-only editing data. Never encoded in a lyric or a TTML node. */
export type ProjectEditing = {
  syncStops: Record<string, { kind: 'word' | 'ruby'; stop: boolean }>;
  emptyBeats: Record<string, { kind: 'word' | 'ruby'; count: number }>;
  skippedAlignmentLineIds: string[];
  ignoredSyncLineIds: string[];
};
export const createProjectEditing = (): ProjectEditing => ({ syncStops: {}, emptyBeats: {}, skippedAlignmentLineIds: [], ignoredSyncLineIds: [] });
export const emptyBeatCount = (editing: ProjectEditing, id: string) => editing.emptyBeats[id]?.count ?? 0;
export function setEmptyBeat(editing: ProjectEditing, id: string, kind: 'word' | 'ruby', count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 32) throw new MessageError(message('editing.beatCount'));
  if (count) editing.emptyBeats[id] = { kind, count };
  else delete editing.emptyBeats[id];
}

export function validateProjectEditing(document: LyricDocument, editing: ProjectEditing) {
  if (!editing || typeof editing !== 'object' || !editing.syncStops || Array.isArray(editing.syncStops) || !editing.emptyBeats || Array.isArray(editing.emptyBeats) || !Array.isArray(editing.skippedAlignmentLineIds) || !Array.isArray(editing.ignoredSyncLineIds)
    || Object.keys(editing).some(key => !['syncStops', 'emptyBeats', 'ignoredSyncLineIds', 'skippedAlignmentLineIds'].includes(key))) throw new MessageError(message('editing.configInvalid'));
  const objects = new Map<string, 'line' | 'word' | 'ruby'>();
  const add = (id: string, kind: 'line' | 'word' | 'ruby') => { if (!id || objects.has(id)) throw new MessageError(message('editing.objectIdInvalid')); objects.set(id, kind); };
  for (const line of document.lines) {
    add(line.id, 'line');
    for (const word of line.words) { add(word.id, 'word'); for (const ruby of word.rubyUnits) add(ruby.id, 'ruby'); }
  }
  for (const [id, value] of Object.entries(editing.emptyBeats)) {
    if (!value || !['word', 'ruby'].includes(value.kind) || objects.get(id) !== value.kind || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > 32 || Object.keys(value).some(key => !['kind', 'count'].includes(key))) throw new MessageError(message('editing.beatsInvalid'));
  }
  for (const [id, value] of Object.entries(editing.syncStops)) {
    if (!value || objects.get(id) !== value.kind || !['word', 'ruby'].includes(value.kind) || typeof value.stop !== 'boolean' || Object.keys(value).some(key => !['kind', 'stop'].includes(key))) throw new MessageError(message('editing.configInvalid'));
  }
  if (new Set(editing.ignoredSyncLineIds).size !== editing.ignoredSyncLineIds.length || editing.ignoredSyncLineIds.some(id => objects.get(id) !== 'line')) throw new MessageError(message('editing.skipTimingInvalid'));
  if (new Set(editing.skippedAlignmentLineIds).size !== editing.skippedAlignmentLineIds.length || editing.skippedAlignmentLineIds.some(id => objects.get(id) !== 'line')) throw new MessageError(message('editing.skipAlignmentInvalid'));
}

/** Called within the same transaction, before commit; never an effect or save repair. */
export function reconcileEditing(before: LyricDocument, after: LyricDocument, editing: ProjectEditing) {
  const lines = new Set(after.lines.map(line => line.id));
  const words = new Map(after.lines.flatMap(line => line.words.map(word => [word.id, word] as const)));
  const rubies = new Set([...words.values()].flatMap(word => word.rubyUnits.map(unit => unit.id)));
  for (const old of before.lines.flatMap(line => line.words)) {
    const word = words.get(old.id);
    if (!word) continue;
    if (old.rubyUnits.length && word.rubyUnits.length && old.rubyUnits.every(unit => !rubies.has(unit.id)) && old.rubyUnits.some(unit => emptyBeatCount(editing, unit.id))) throw new MessageError(message('editing.replaceRubyBeats'));
    if (old.rubyUnits.length === word.rubyUnits.length) continue;
    if (!old.rubyUnits.length && word.rubyUnits.length && emptyBeatCount(editing, word.id)) {
      const first = word.rubyUnits[0].id;
      if (emptyBeatCount(editing, first)) throw new MessageError(message('editing.duplicateBeats'));
      setEmptyBeat(editing, first, 'ruby', emptyBeatCount(editing, word.id)); delete editing.emptyBeats[word.id];
    } else if (old.rubyUnits.length && !word.rubyUnits.length) {
      // Moving Ruby keeps its own identity and configuration at the destination.
      const removed = old.rubyUnits.filter(unit => !rubies.has(unit.id));
      const configured = removed.filter(unit => emptyBeatCount(editing, unit.id));
      if (configured.length > 1 || configured.length && (configured[0].id !== old.rubyUnits[0].id || emptyBeatCount(editing, word.id))) throw new MessageError(message('editing.removeRubyBeats'));
      if (configured.length) setEmptyBeat(editing, word.id, 'word', emptyBeatCount(editing, configured[0].id));
    }
  }
  for (const old of before.lines.flatMap(line => line.words)) {
    const word = words.get(old.id);
    if (!word) continue;
    const oldTail = old.rubyUnits.at(-1);
    if (oldTail && word.rubyUnits.length && old.rubyUnits.every(unit => !rubies.has(unit.id)) && editing.syncStops[oldTail.id]) {
      editing.syncStops[word.rubyUnits.at(-1)!.id] = {kind:'ruby',stop:editing.syncStops[oldTail.id].stop};
    }
    if (!old.rubyUnits.length && word.rubyUnits.length && editing.syncStops[word.id]) {
      editing.syncStops[word.rubyUnits.at(-1)!.id] = { kind: 'ruby', stop: editing.syncStops[word.id].stop };
      delete editing.syncStops[word.id];
    } else if (old.rubyUnits.length && !word.rubyUnits.length) {
      const last = old.rubyUnits.at(-1)!;
      if (!rubies.has(last.id) && editing.syncStops[last.id]) editing.syncStops[word.id] = { kind: 'word', stop: editing.syncStops[last.id].stop };
    }
  }
  for (const [id, value] of Object.entries(editing.syncStops)) if (!(value.kind === 'word' ? words.has(id) : rubies.has(id))) delete editing.syncStops[id];
  for (const [id, value] of Object.entries(editing.emptyBeats)) if (!(value.kind === 'word' ? words.has(id) : rubies.has(id))) delete editing.emptyBeats[id];
  editing.skippedAlignmentLineIds = editing.skippedAlignmentLineIds.filter(id => lines.has(id));
  editing.ignoredSyncLineIds = editing.ignoredSyncLineIds.filter(id => lines.has(id));
}

export function remapEditing(source: ProjectEditing, ids: Map<string, string>): ProjectEditing {
  return {
    syncStops: Object.fromEntries(Object.entries(source.syncStops).filter(([id]) => ids.has(id)).map(([id, value]) => [ids.get(id)!, value])),
    emptyBeats: Object.fromEntries(Object.entries(source.emptyBeats).filter(([id]) => ids.has(id)).map(([id, value]) => [ids.get(id)!, value])),
    skippedAlignmentLineIds: source.skippedAlignmentLineIds.filter(id => ids.has(id)).map(id => ids.get(id)!),
    ignoredSyncLineIds: source.ignoredSyncLineIds.filter(id => ids.has(id)).map(id => ids.get(id)!),
  };
}

export type BackgroundDefaults = { skipAlignment: boolean; skipSync: boolean };
export const defaultBackgroundDefaults: BackgroundDefaults = {skipAlignment: true, skipSync: true};
/** Apply only identity changes; copied project editing state remains authoritative. */
export function applyBackgroundDefaults(before: LyricDocument, after: LyricDocument, editing: ProjectEditing, defaults: BackgroundDefaults) {
  const beforeById = new Map(before.lines.map(item => [item.id, item]));
  const toggled = new Map<string, boolean>();
  for (const line of after.lines) {
    const previous = beforeById.get(line.id);
    if (Boolean(previous?.backgroundOf) !== Boolean(line.backgroundOf)) toggled.set(line.id, Boolean(line.backgroundOf));
  }
  if (!toggled.size) return;
  for (const [key, enabled] of [['skippedAlignmentLineIds', defaults.skipAlignment], ['ignoredSyncLineIds', defaults.skipSync]] as const) {
    if (!enabled) continue;
    const list = editing[key].filter(id => !toggled.has(id));
    for (const [id, isBg] of toggled) if (isBg) list.push(id);
    editing[key] = list;
  }
}
