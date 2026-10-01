import type { LyricEditorState } from '../../domain/lyric-commands';
import { LYRIC_SCHEMA_VERSION, type LyricDocument } from '../../domain/lyric-document';

const DATABASE = 'lazulite-studio-recovery-v6';
const STORE = 'projects';
const RECORD_VERSION = 6;
const keyFor = (projectId: string) => `project:${projectId}`;

export type RecoveryRecord = {
  version: number;
  projectId: string;
  documentIdentity: string;
  savedAt: string;
  state: LyricEditorState;
  baseRevision?: string;
};

export type RecoveryAdapter = {
  save(slotKey: string, documentIdentity: string, state: LyricEditorState, baseRevision?: string): Promise<void>;
  readCheckpoint(slotKey: string): Promise<RecoveryRecord | null>;
  load(slotKey: string, documentIdentity: string): Promise<LyricEditorState | null>;
  clear(slotKey: string): Promise<void>;
  discard(slotKey: string): Promise<void>;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local recovery is unavailable in this browser'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
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

const isState = (value: unknown): value is LyricEditorState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as LyricEditorState;
  const validDocument = (document: unknown) => {
    if (!document || typeof document !== 'object') return false;
    const item = document as LyricDocument;
    return item.schemaVersion === LYRIC_SCHEMA_VERSION && Array.isArray(item.lines) && Array.isArray(item.romanizationTracks) && Array.isArray(item.agents)
      && !!item.metadata && typeof item.metadata === 'object'
      && item.lines.every((line) => !!line && typeof line.id === 'string' && Array.isArray(line.words)
        && line.words.every((word) => !!word && typeof word.id === 'string' && typeof word.text === 'string' && Array.isArray(word.rubyUnits) && Array.isArray(word.alignmentUnits)));
  };
  return !!candidate.present && Array.isArray(candidate.past) && Array.isArray(candidate.future)
    && candidate.past.length <= 256 && candidate.future.length <= 256
    && [candidate.present, ...candidate.past, ...candidate.future].every(validDocument);
};
const isRecord = (value: unknown): value is RecoveryRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as RecoveryRecord;
  return record.version === RECORD_VERSION && typeof record.projectId === 'string'
    && typeof record.documentIdentity === 'string' && typeof record.savedAt === 'string' && isState(record.state);
};

export function createRecoveryAdapter(): RecoveryAdapter {
  return {
    async save(projectId, documentIdentity, state, baseRevision) {
      if (!projectId || !documentIdentity || !isState(state)) throw new Error('Invalid recovery checkpoint');
      const record: RecoveryRecord = { version: RECORD_VERSION, projectId, documentIdentity, savedAt: new Date().toISOString(), state, baseRevision };
      await transaction('readwrite', (store) => store.put(record, keyFor(projectId)));
    },
    async readCheckpoint(projectId) {
      const record = await transaction<RecoveryRecord | undefined>('readonly', (store) => store.get(keyFor(projectId)));
      if (record === undefined) return null;
      if (!isRecord(record) || record.projectId !== projectId) throw new Error('Local recovery checkpoint is incompatible');
      return record;
    },
    async load(projectId, documentIdentity) {
      const record = await this.readCheckpoint(projectId);
      if (record === null) return null;
      if (!isRecord(record) || record.projectId !== projectId || record.documentIdentity !== documentIdentity) {
        throw new Error('Local recovery checkpoint is incompatible or belongs to another document');
      }
      return record.state;
    },
    async clear(projectId) {
      await transaction('readwrite', (store) => store.delete(keyFor(projectId)));
    },
    async discard(projectId) {
      await transaction('readwrite', (store) => store.delete(keyFor(projectId)));
    },
  };
}
