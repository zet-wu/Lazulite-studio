import { useState } from 'react';
import type { LyricDocument } from '../../domain/lyric-document';
import type { ProjectEditing } from '../../domain/project-editing';
import type { SyncCursor } from '../../domain/sync-editing';
export type SyncProgress = { consumed: number; completed: boolean };
const initial: SyncProgress = { consumed: 0, completed: false };
export function useSyncProgress(document: LyricDocument, editing: ProjectEditing, cursor: SyncCursor | null, targetVersion: number, historyVersion: number) {
  const line = document.lines.find(line => line.id === cursor?.lineId);
  const word = line?.words.find(word => word.id === cursor?.wordId);
  // Time stamps do not reset progress. Identity, participation and structural edits do.
  const key = JSON.stringify([cursor, targetVersion, historyVersion, line?.backgroundOf, editing.ignoredSyncLineIds.includes(line?.id ?? ''),
    editing.emptyBeats[cursor?.rubyUnitId ?? cursor?.wordId ?? ''],
    line?.words.map(word => [word.id, word.text, word.rubyUnits.map(unit => [unit.id, unit.reading])]), word?.id]);
  const [state, setState] = useState({ key, progress: initial });
  return [state.key === key ? state.progress : initial, (progress: SyncProgress) => setState({ key, progress })] as const;
}
