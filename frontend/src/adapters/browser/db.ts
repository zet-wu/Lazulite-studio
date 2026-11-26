import { message, MessageError } from '../../domain/messages';
import { createProjectDocument, type ProjectSnapshot } from '../../domain/project-document';
import { serializeProject } from '../project-codec';
import { ApiError, type Asset, type ProjectSummary, type RichDocumentEnvelope } from '../http/client';

export const browserDatabaseName = 'lazulite-studio-browser-v1';
export type BrowserAsset = Asset & { project_id: string | null; sample_rate: number; channels: number; ephemeral: boolean; blob?: Blob };
type BrowserProject = ProjectSummary & { created_at: string; creation_key: string };
type BrowserDocument = RichDocumentEnvelope & { operation_id?: string };
const sessionAudio = new Map<string, Blob>();
let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(browserDatabaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('documents', { keyPath: 'project_id' });
      db.createObjectStore('assets', { keyPath: 'id' }).createIndex('project_id', 'project_id');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  connection = attempt.catch(() => { connection = undefined; throw new MessageError(message('demo.storageUnavailable')); });
  return connection;
}
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Keep revision checks, snapshots and asset ownership in one IDB transaction. */
async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
  try {
    const value = await run(tx);
    await complete;
    return value;
  } catch (error) {
    try { tx.abort(); } catch { /* The failed request may have already aborted the transaction. */ }
    await complete.catch(() => undefined);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new MessageError(message('demo.storageFailed'));
    throw error;
  }
}
function rejected(status: number, code: string): never {
  throw new ApiError(status, { code, message: code, request_id: '', retryable: false });
}
function requireValue<T>(value: T | undefined): T {
  return value ?? rejected(404, 'project_missing');
}
const revision = (current: string) => `local-r${Number(current.slice(7)) + 1}`;
const changed = (document: RichDocumentEnvelope) => {
  const channel = new BroadcastChannel('studio-browser-revisions');
  channel.postMessage({ type: 'revision_changed', project_id: document.project_id, revision: document.revision, source_asset_id: document.source_asset_id });
  channel.close();
};

export async function stageAudio(asset: BrowserAsset, blob: Blob): Promise<void> {
  // Only Blob persistence falls back to memory; document storage failures stay visible.
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put({ ...asset, blob });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    if (!(error instanceof DOMException) || !['QuotaExceededError', 'UnknownError', 'InvalidStateError'].includes(error.name)) throw error;
    await transaction(['assets'], 'readwrite', async tx => { await result(tx.objectStore('assets').put({ ...asset, ephemeral: true })); });
    sessionAudio.set(asset.id, blob);
  }
}

export const browserStore = {
  list: () => transaction(['projects'], 'readonly', async tx => (await result(tx.objectStore('projects').getAll()) as BrowserProject[]).sort((a, b) => b.updated_at.localeCompare(a.updated_at))),
  project: (id: string) => transaction(['projects'], 'readonly', async tx => requireValue(await result<BrowserProject | undefined>(tx.objectStore('projects').get(id)))),
  document: (id: string) => transaction(['documents'], 'readonly', async tx => requireValue(await result<BrowserDocument | undefined>(tx.objectStore('documents').get(id)))),
  asset: (id: string) => transaction(['assets'], 'readonly', tx => result<BrowserAsset | undefined>(tx.objectStore('assets').get(id))),
  async audio(id: string) { return sessionAudio.get(id) ?? (await this.asset(id))?.blob; },
  async discard(id: string) {
    await transaction(['assets'], 'readwrite', async tx => {
      const store = tx.objectStore('assets'), asset = await result<BrowserAsset | undefined>(store.get(id));
      if (asset?.project_id) rejected(409, 'asset_bound');
      await result(store.delete(id));
    });
    sessionAudio.delete(id);
    return { cancelled: id };
  },
  async create(name: string, uploadId: string | null, key: string, signal?: AbortSignal): Promise<ProjectSummary> {
    const document = serializeProject(createProjectDocument());
    return transaction(['projects', 'documents', 'assets'], 'readwrite', async tx => {
      signal?.throwIfAborted();
      const projects = tx.objectStore('projects'), previous = await result<BrowserProject | undefined>(projects.get(key));
      if (previous) return previous;
      const assets = tx.objectStore('assets');
      const asset = uploadId ? requireValue(await result<BrowserAsset | undefined>(assets.get(uploadId))) : null;
      if (asset?.project_id) rejected(409, 'asset_bound');
      const now = new Date().toISOString();
      const project: BrowserProject = { schema_version: 'studio-project-v1', id: key, name, creation_key: key, created_at: now, updated_at: now, asset };
      const envelope: BrowserDocument = { schema_version: 'studio-document-v9', project_id: key, source_asset_id: asset?.id ?? null, revision: 'local-r1', document };
      if (asset) await result(assets.put({ ...asset, project_id: key }));
      await result(projects.put({ ...project, asset: asset ? summaryAsset(asset) : null }));
      await result(tx.objectStore('documents').put(envelope));
      signal?.throwIfAborted();
      return { ...project, asset: asset ? summaryAsset(asset) : null };
    });
  },
  async save(id: string, snapshot: ProjectSnapshot, base: string, operation: string, seq: number) {
    const document = await transaction(['projects', 'documents'], 'readwrite', async tx => {
      const documents = tx.objectStore('documents'), current = requireValue(await result<BrowserDocument | undefined>(documents.get(id)));
      if (current.operation_id === operation) return current;
      if (current.revision !== base) rejected(412, 'revision_conflict');
      const next: BrowserDocument = { ...current, document: snapshot, revision: revision(base), operation_id: operation, client_seq: seq };
      await result(documents.put(next));
      const projects = tx.objectStore('projects'), project = requireValue(await result<BrowserProject | undefined>(projects.get(id)));
      await result(projects.put({ ...project, updated_at: new Date().toISOString() }));
      return next;
    });
    changed(document);
    return { revision: document.revision, etag: `"${document.revision}"` };
  },
  async attach(id: string, payload: { upload_id: string; revision: string; expected_asset_id: string | null; operation_id: string }) {
    let oldId: string | null = null;
    const saved = await transaction(['projects', 'documents', 'assets'], 'readwrite', async tx => {
      const documents = tx.objectStore('documents'), current = requireValue(await result<BrowserDocument | undefined>(documents.get(id)));
      const projects = tx.objectStore('projects'), project = requireValue(await result<BrowserProject | undefined>(projects.get(id)));
      if (current.operation_id === payload.operation_id && current.source_asset_id === payload.upload_id) return { document: current, asset: requireValue(project.asset ?? undefined) };
      if (current.revision !== payload.revision || current.source_asset_id !== payload.expected_asset_id) rejected(412, 'revision_conflict');
      const assets = tx.objectStore('assets'), asset = requireValue(await result<BrowserAsset | undefined>(assets.get(payload.upload_id)));
      if (asset.project_id) rejected(409, 'asset_bound');
      oldId = current.source_asset_id;
      const document: BrowserDocument = { ...current, source_asset_id: asset.id, revision: revision(current.revision), operation_id: payload.operation_id,
        document: { ...current.document, acoustics: { analysisId: null, segments: [] } } };
      await result(assets.put({ ...asset, project_id: id }));
      if (oldId) await result(assets.delete(oldId));
      await result(documents.put(document));
      await result(projects.put({ ...project, asset: summaryAsset(asset), updated_at: new Date().toISOString() }));
      return { document, asset: summaryAsset(asset) };
    });
    if (oldId) sessionAudio.delete(oldId);
    changed(saved.document);
    return { asset: saved.asset, revision: saved.document.revision, cleanup_pending: false };
  },
  async delete(id: string) {
    const ids = await transaction(['projects', 'documents', 'assets'], 'readwrite', async tx => {
      const assets = tx.objectStore('assets'), ids = await result(assets.index('project_id').getAllKeys(id));
      for (const assetId of ids) await result(assets.delete(assetId));
      await result(tx.objectStore('documents').delete(id));
      await result(tx.objectStore('projects').delete(id));
      return ids;
    });
    for (const assetId of ids) sessionAudio.delete(String(assetId));
    return { deleted: id };
  },
  async storage(id: string) {
    return transaction(['projects', 'documents', 'assets'], 'readonly', async tx => {
      const project = requireValue(await result<BrowserProject | undefined>(tx.objectStore('projects').get(id)));
      const document = await result(tx.objectStore('documents').get(id));
      const assets = await result<BrowserAsset[]>(tx.objectStore('assets').index('project_id').getAll(id));
      const source = assets.reduce((sum, asset) => sum + (asset.blob?.size ?? 0), 0);
      const snapshots = new Blob([JSON.stringify(document)]).size;
      const other = new Blob([JSON.stringify(project)]).size;
      return { total_bytes: source + snapshots + other, measured_at: new Date().toISOString(), categories: { source, snapshots, other, vocals: 0, cache: 0 } };
    });
  },
};

/** Project summaries never carry Blob or decoded PCM payloads. */
function summaryAsset(asset: BrowserAsset): Asset {
  const { blob: _blob, project_id: _project, sample_rate: _rate, channels: _channels, ...summary } = asset;
  return summary;
}
