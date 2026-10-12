import { useEffect, useRef, useState } from 'react';
import { requestHeaders } from '../adapters/http/client';
export type SearchConditions = { title: string; artist: string; album: string };
export const EMPTY_CONDITIONS: SearchConditions = { title: '', artist: '', album: '' };
export function useSearchConditions(projectId?: string, sourceAssetId?: string) {
  const [values, setValues] = useState<SearchConditions>(EMPTY_CONDITIONS);
  const [ready, setReady] = useState(!projectId), [error, setError] = useState('');
  const latest = useRef(values), pending = useRef<SearchConditions | null>(null), saving = useRef(false);
  const alive = useRef(true);
  const [readingMetadata, setReadingMetadata] = useState(false), [metadataError, setMetadataError] = useState('');
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
      if (!r.ok) throw new Error('获取条件读取失败，请重试');
      const next: SearchConditions = await r.json();
      if (typeof next.title !== 'string' || typeof next.artist !== 'string' || typeof next.album !== 'string') throw new Error('获取条件响应无效');
      if (alive.current) { latest.current = next; setValues(next); setReady(true); setError(''); }
    } catch (e) { if (alive.current && !signal?.aborted) setError(e instanceof Error ? e.message : '获取条件读取失败'); }
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
          if (!r.ok) throw new Error(r.status === 404 ? '项目已删除' : '获取条件保存失败，请重试');
          if (alive.current) setError('');
        } catch (e) {
          pending.current ??= captured;
          if (alive.current) setError(e instanceof Error ? e.message : '获取条件保存失败');
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
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/source-metadata`, {credentials:'include',headers:requestHeaders(),signal:controller.signal});
      if (!response.ok) throw new Error('源音频标签读取失败，请重试');
      const result = await response.json();
      if (!current()) return;
      if (result.asset_id !== sourceAssetId) throw new Error('源音频已变化，请重新填入');
      if (!result.conditions || ['title','artist','album'].some(key => typeof result.conditions[key] !== 'string')) throw new Error('源音频标签响应无效');
      replace(result.conditions);
    } catch (cause) { if (current()) setMetadataError(cause instanceof Error ? cause.message : '源音频标签读取失败'); }
    finally { if (metadataRequest.current === controller) setReadingMetadata(false); }
  };
  return { values, ready, error, change, retry: () => ready ? flush() : load(), fillMetadata, readingMetadata, metadataError, hasSource: !!sourceAssetId };
}
