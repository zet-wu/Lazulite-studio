import type { Capabilities, Session } from '../http/client';
import { browserStore } from './db';

export const browserApi = {
  getSession: async (): Promise<Session> => ({ schema_version: 'studio-session-v1', authenticated: true, mode: 'local', user: null, library_id: 'browser-v1' }),
  getCapabilities: async (): Promise<Capabilities> => ({ schema_version: 'studio-capabilities-v1', items: [] }),
  listProjects: async (_cursor?: string) => ({ schema_version: 'studio-project-list-v1' as const, items: await browserStore.list(), next_cursor: null }),
  getProject: (id: string) => browserStore.project(id),
  createProject: (name: string, uploadId: string | null, key: string, signal?: AbortSignal, _sourceFilename?: string) => browserStore.create(name, uploadId, key, signal),
  deleteProject: (id: string) => browserStore.delete(id),
  projectStorage: (id: string) => browserStore.storage(id),
  getDocumentEnvelope: (id: string) => browserStore.document(id),
  saveRichDocument: (id: string, document: Parameters<typeof browserStore.save>[1], base: string, operation: string, seq: number, _etag?: string) => browserStore.save(id, document, base, operation, seq),
  discardUpload: (id: string) => browserStore.discard(id),
  attachMusic: (id: string, payload: Parameters<typeof browserStore.attach>[1]) => browserStore.attach(id, payload),
  cleanupMusic: async (_id: string) => ({ cleanup_pending: false }),
};
