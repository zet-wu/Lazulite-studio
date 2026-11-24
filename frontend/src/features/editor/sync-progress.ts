import { useSyncStyle } from '../../adapters/sync-style';
import { useState } from 'react';
import type { LyricDocument } from '../../domain/lyric-document';
import type { ProjectEditing } from '../../domain/project-editing';
import type { SyncCursor } from '../../domain/sync-editing';
export type SyncProgress = { consumed: number; completed: boolean; started?: boolean };
const initial: SyncProgress = { consumed: 0, completed: false };
export function useSyncProgress(document: LyricDocument, editing: ProjectEditing, cursor: SyncCursor | null, targetVersion: number, historyVersion: number) {
  const [style] = useSyncStyle();
  const progressKey = (target: SyncCursor | null) => {
    const line = document.lines.find(line => line.id === target?.lineId);
    const word = line?.words.find(word => word.id === target?.wordId);
    // Time stamps do not reset progress. Identity, participation and structural edits do.
    return JSON.stringify([style, target, targetVersion, historyVersion, line?.backgroundOf, editing.ignoredSyncLineIds.includes(line?.id ?? ''),
      editing.emptyBeats[target?.rubyUnitId ?? target?.wordId ?? ''], editing.syncStops[target?.rubyUnitId ?? target?.wordId ?? ''],
      line?.words.map(word => [word.id, word.text, word.rubyUnits.map(unit => [unit.id, unit.reading])]), word?.id]);
  };
  const key = progressKey(cursor);
  const [state, setState] = useState({ key, progress: initial });
  return [state.key === key ? state.progress : initial, (progress: SyncProgress, nextCursor?: SyncCursor) => setState({ key: nextCursor ? progressKey(nextCursor) : key, progress })] as const;
}
