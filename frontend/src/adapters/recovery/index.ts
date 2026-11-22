import { libraryIdentity } from '../preferences';
import { validateKaraoke } from '../../domain/karaoke';
import { assertAmll, validateAgents } from '../../domain/amll-compatibility';
import { validateProjectEditing } from '../../domain/project-editing';
import { validateSegments, type ProjectDocument } from '../../domain/project-document';
import { LYRIC_SCHEMA_VERSION, type LyricDocument } from '../../domain/lyric-document';

const DATABASE = 'lazulite-studio-recovery-v11';
const STORE = 'projects';
const RECORD_VERSION = 11;
const keyFor = (projectId: string) => `project:${projectId}`;

export type RecoveryRecord = {
  version: number;
  projectId: string;
  project: ProjectDocument;
  baseRevision: string;
  sourceAssetId: string | null;
};

export type RecoveryAdapter = {
  save(projectId: string, project: ProjectDocument, baseRevision: string, sourceAssetId?: string | null): Promise<void>;
  readCheckpoint(slotKey: string): Promise<RecoveryRecord | null>;
  clear(slotKey: string): Promise<void>;
};

let cachedDatabase: { name: string; promise: Promise<IDBDatabase> } | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local recovery is unavailable in this browser'));
  const name = `${DATABASE}:${libraryIdentity()}`;
  if (cachedDatabase && cachedDatabase.name === name) return cachedDatabase.promise;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); if (cachedDatabase?.promise === promise) cachedDatabase = null; };
      database.onclose = () => { if (cachedDatabase?.promise === promise) cachedDatabase = null; };
      resolve(database);
    };
    request.onerror = () => { if (cachedDatabase?.promise === promise) cachedDatabase = null; reject(new Error('Could not open local recovery storage')); };
  });
  cachedDatabase = { name, promise };
  return promise;
}

const transaction = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    let result: T | undefined;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(new Error('Local recovery storage operation failed'));
    tx.onabort = () => reject(new Error('Local recovery storage operation aborted'));
  });
};

const validDocument = (document: unknown): document is ProjectDocument => {
    if (!document || typeof document !== 'object') return false;
    const project = document as ProjectDocument;
    if (project.schemaVersion !== 'studio-project-v9' || !project.acoustics || !Array.isArray(project.acoustics.segments)) return false;
    if (project.acoustics.analysisId !== null && typeof project.acoustics.analysisId !== 'string') return false;
    const item = project.lyrics as LyricDocument;
    if (!item || typeof item !== 'object') return false;
    if (item.schemaVersion !== LYRIC_SCHEMA_VERSION || !Array.isArray(item.lines) || !Array.isArray(item.romanizationTracks) || !Array.isArray(item.translationTracks) || !Array.isArray(item.agents)
      || !item.metadata || typeof item.metadata !== 'object'
      || !item.lines.every((line) => !!line && typeof line.id === 'string' && Array.isArray(line.words)
        && line.words.every((word) => !!word && typeof word.id === 'string' && typeof word.text === 'string' && typeof word.obscene === 'boolean' && Array.isArray(word.rubyUnits)))) return false;
    const lineIds = new Set(item.lines.map(line => line.id));
    if (!Array.isArray(project.lineOrder) || project.lineOrder.some(id => !lineIds.has(id))) return false;
    try { validateKaraoke(item, project.karaoke); assertAmll(item, project.amll); validateAgents(item); validateSegments(project.acoustics.segments); validateProjectEditing(item, project.editing); } catch { return false; }
    return true;
  };
const isRecord = (value: unknown): value is RecoveryRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as RecoveryRecord;
  return (record.sourceAssetId===null || typeof record.sourceAssetId==='string') && record.version === RECORD_VERSION && typeof record.projectId === 'string'
    && typeof record.baseRevision === 'string' && validDocument(record.project);
};

export function createRecoveryAdapter(): RecoveryAdapter {
  return {
    async save(projectId, project, baseRevision, sourceAssetId = null) {
      const record: RecoveryRecord = { version: RECORD_VERSION, projectId, project, baseRevision, sourceAssetId };
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
