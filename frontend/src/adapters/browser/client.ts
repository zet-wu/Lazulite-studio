import type { Capabilities, Session } from '../http/client';
import { browserStore } from './db';
import { computeWaveformWindow, getAudioObjectUrl, prepareProjectMedia, releaseProjectMedia, slicePcmWindow } from './media';

export const browserApi = {
  getSession: async (): Promise<Session> => ({ schema_version: 'studio-session-v1', authenticated: true, mode: 'local', user: null, library_id: 'browser-v1' }),
  getCapabilities: async (): Promise<Capabilities> => ({ schema_version: 'studio-capabilities-v1', items: [] }),
  listProjects: async (_cursor?: string) => ({ schema_version: 'studio-project-list-v1' as const, items: await browserStore.list(), next_cursor: null }),
  getProject: async (id: string, signal?: AbortSignal) => {
    const project = await browserStore.project(id);
    signal?.throwIfAborted();
    const cancel = () => releaseProjectMedia(id);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await prepareProjectMedia(id, project.asset?.id ?? null);
      signal?.throwIfAborted();
      return project;
    } finally { signal?.removeEventListener('abort', cancel); }
  },
  createProject: (name: string, uploadId: string | null, key: string, signal?: AbortSignal, _sourceFilename?: string) => browserStore.create(name, uploadId, key, signal),
  deleteProject: async (id: string) => { const deleted = await browserStore.delete(id); releaseProjectMedia(id); return deleted; },
  projectStorage: (id: string) => browserStore.storage(id),
  getDocumentEnvelope: (id: string) => browserStore.document(id),
  saveRichDocument: (id: string, document: Parameters<typeof browserStore.save>[1], base: string, operation: string, seq: number, _etag?: string) => browserStore.save(id, document, base, operation, seq),
  discardUpload: (id: string) => browserStore.discard(id),
  attachMusic: async (id: string, payload: Parameters<typeof browserStore.attach>[1]) => {
    const saved = await browserStore.attach(id, payload);
    await prepareProjectMedia(id, saved.asset.id);
    return saved;
  },
  cleanupMusic: async (_id: string) => ({ cleanup_pending: false }),
  getWaveform: (id: string, startMs = 0, endMs?: number, level = 8, signal?: AbortSignal, _vocal?: string | null) => computeWaveformWindow(id, startMs, endMs, level, signal),
  getPcmWindow: (id: string, startMs: number, endMs: number, signal?: AbortSignal, _vocal?: string | null) => slicePcmWindow(id, startMs, endMs, signal),
  audioUrl: (id: string, _vocal?: string | null, source?: string) => getAudioObjectUrl(id, source),
};
