import { readSourceMetadata } from '../adapters/http/source-metadata';
import {message,MessageError,errorMessage} from '../domain/messages';
import {useMessageText} from '../shared/useMessageText';
import { useEffect, useRef, useState } from 'react';
import { requestHeaders } from '../adapters/http/client';
export type SearchConditions = { title: string; artist: string; album: string };
export const EMPTY_CONDITIONS: SearchConditions = { title: '', artist: '', album: '' };
export function useSearchConditions(projectId?: string, sourceAssetId?: string) {
  const [values, setValues] = useState<SearchConditions>(EMPTY_CONDITIONS);
  const [ready, setReady] = useState(!projectId), [error, setError] = useMessageText('');
  const latest = useRef(values), pending = useRef<SearchConditions | null>(null), saving = useRef(false);
  const alive = useRef(true);
  const [readingMetadata, setReadingMetadata] = useState(false), [metadataError, setMetadataError] = useMessageText('');
  const metadataRequest = useRef<AbortController | null>(null), editVersion = useRef(0);
  const identity = `${projectId ?? ''}:${sourceAssetId ?? ''}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => {
    metadataRequest.current?.abort(); setReadingMetadata(false); setMetadataError('');
    return () => metadataRequest.current?.abort();
  }, [identity]);
  const url = `/api/v1/projects/${encodeURIComponent(projectId ?? '')}/search-conditions`;
  const load = async (signal?: AbortSignal) => {
    try {
      const r = await fetch(url, { credentials: 'include', headers: requestHeaders(), signal });
      if (!r.ok) throw new MessageError(message('search.conditionsReadFailed'));
      const next: SearchConditions = await r.json();
      if (typeof next.title !== 'string' || typeof next.artist !== 'string' || typeof next.album !== 'string') throw new MessageError(message('search.conditionsInvalid'));
      if (alive.current) { latest.current = next; setValues(next); setReady(true); setError(''); }
    } catch (e) { if (alive.current && !signal?.aborted) setError(errorMessage(e)); }
  };
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    if (projectId) void load(controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, [projectId]);
  const flush = async () => {
    if (!projectId || saving.current) return;
    saving.current = true;
    try {
      while (pending.current) {
        const captured = pending.current; pending.current = null;
        try {
          const r = await fetch(url, { method: 'PUT', credentials: 'include', keepalive: true, headers: requestHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(captured) });
          if (!r.ok) throw new MessageError(message(r.status===404?'save.deleted':'search.conditionsSaveFailed'));
          if (alive.current) setError('');
        } catch (e) {
          pending.current ??= captured;
          if (alive.current) setError(errorMessage(e));
          break;
        }
      }
    } finally { saving.current = false; }
  };
  const replace = (next: SearchConditions) => {
    editVersion.current++;
    metadataRequest.current?.abort(); setReadingMetadata(false); setMetadataError('');
    latest.current = next; setValues(next);
    if (projectId) { pending.current = next; void flush(); }
  };
  const change = (field: keyof SearchConditions, value: string) => replace({ ...latest.current, [field]: value });
  const fillMetadata = async () => {
    if (!projectId || !sourceAssetId || !ready) return;
    metadataRequest.current?.abort();
    const controller = new AbortController(); metadataRequest.current = controller;
    const version = editVersion.current, capturedIdentity = identity;
    const current = () => alive.current && !controller.signal.aborted && editVersion.current === version && currentIdentity.current === capturedIdentity;
    setReadingMetadata(true); setMetadataError('');
    try {
      const result = await readSourceMetadata(projectId, sourceAssetId, controller.signal, false);
      if (!current()) return;
      replace(result);
    } catch (cause) { if (current()) setMetadataError(errorMessage(cause)); }
    finally { if (metadataRequest.current === controller) setReadingMetadata(false); }
  };
  return { values, ready, error, change, retry: () => ready ? flush() : load(), fillMetadata, readingMetadata, metadataError, hasSource: !!sourceAssetId };
}
