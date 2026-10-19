import { libraryIdentity } from '../preferences';
import { validateKaraoke } from '../../domain/karaoke';
import { assertAmll, validateAgents } from '../../domain/amll-compatibility';
import { validateProjectEditing } from '../../domain/project-editing';
import { validateSegments, type ProjectDocument } from '../../domain/project-document';
import { LYRIC_SCHEMA_VERSION, type LyricDocument } from '../../domain/lyric-document';

const DATABASE = 'lazulite-studio-recovery-v10';
const STORE = 'projects';
const RECORD_VERSION = 10;
const keyFor = (projectId: string) => `project:${projectId}`;

export type RecoveryRecord = {
  version: number;
  projectId: string;
  project: ProjectDocument;
  baseRevision: string;
};

export type RecoveryAdapter = {
  save(projectId: string, project: ProjectDocument, baseRevision: string): Promise<void>;
  readCheckpoint(slotKey: string): Promise<RecoveryRecord | null>;
  clear(slotKey: string): Promise<void>;
};

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local recovery is unavailable in this browser'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`${DATABASE}:${libraryIdentity()}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open local recovery storage'));
  });
}

const transaction = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    let result: T | undefined;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { database.close(); resolve(result as T); };
    tx.onerror = () => { database.close(); reject(new Error('Local recovery storage operation failed')); };
    tx.onabort = () => { database.close(); reject(new Error('Local recovery storage operation aborted')); };
  });
};

const validDocument = (document: unknown): document is ProjectDocument => {
    if (!document || typeof document !== 'object') return false;
    const project = document as ProjectDocument;
    if (project.schemaVersion !== 'studio-project-v9' || !project.acoustics || !Array.isArray(project.acoustics.segments)) return false;
    if (project.acoustics.analysisId !== null && typeof project.acoustics.analysisId !== 'string') return false;
    try { validateKaraoke(project.lyrics, project.karaoke); assertAmll(project.lyrics,project.amll); validateAgents(project.lyrics); if(!Array.isArray(project.lineOrder)||project.lineOrder.some(id=>!project.lyrics.lines.some(line=>line.id===id)))return false; validateSegments(project.acoustics.segments, Number.MAX_SAFE_INTEGER); validateProjectEditing(project.lyrics, project.editing); } catch { return false; }
    const item = project.lyrics as LyricDocument;
    if (!item || typeof item !== 'object') return false;
    return item.schemaVersion === LYRIC_SCHEMA_VERSION && Array.isArray(item.lines) && Array.isArray(item.romanizationTracks) && Array.isArray(item.translationTracks) && Array.isArray(item.agents)
      && !!item.metadata && typeof item.metadata === 'object'
      && item.lines.every((line) => !!line && typeof line.id === 'string' && Array.isArray(line.words)
        && line.words.every((word) => !!word && typeof word.id === 'string' && typeof word.text === 'string' && typeof word.obscene === 'boolean' && Array.isArray(word.rubyUnits) ));
  };
const isRecord = (value: unknown): value is RecoveryRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as RecoveryRecord;
  return record.version === RECORD_VERSION && typeof record.projectId === 'string'
    && typeof record.baseRevision === 'string' && validDocument(record.project);
};

export function createRecoveryAdapter(): RecoveryAdapter {
  return {
    async save(projectId, project, baseRevision) {
      const record: RecoveryRecord = { version: RECORD_VERSION, projectId, project, baseRevision };
      await transaction('readwrite', (store) => store.put(record, keyFor(projectId)));
    },
    async readCheckpoint(projectId) {
      const record = await transaction<RecoveryRecord | undefined>('readonly', (store) => store.get(keyFor(projectId)));
      if (record === undefined) return null;
      if (!isRecord(record) || record.projectId !== projectId) throw new Error('Local recovery checkpoint is incompatible');
      return record;
    },
    async clear(projectId) {
      await transaction('readwrite', (store) => store.delete(keyFor(projectId)));
    },
  };
}
