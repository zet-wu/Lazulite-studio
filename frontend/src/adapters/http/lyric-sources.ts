import { lyricCapabilities } from '../lyric-capabilities';
import { requestHeaders } from './client';
import { importLyricFile, type LyricFormat } from '../lyric-formats';
import { attachSidecar } from '../source-codec';
export type Source = 'netease' | 'qqmusic' | 'kugou' | 'amll';
export type Candidate = { source: Source; id: string; title: string; artists: string[]; album: string; duration_ms: number | null; songmid?: string | null; songid?: string | null; platform?: string | null; file?: string | null };
export class SourceError extends Error { constructor(message: string, readonly code: string) { super(message); } }
export async function sourceRequest<T>(action: 'search' | 'fetch' | 'resolve', body: unknown, signal?: AbortSignal): Promise<T> {
 const response = await fetch(`/api/v1/lyric-sources/${action}`, { method: 'POST', credentials: 'include', signal, headers: requestHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
 if (!response.ok) { const error = await response.json(); throw new SourceError(response.status === 401 ? 'Studio 会话已失效，请登录工作台后重试。' : error.message ?? error.detail?.message ?? `请求失败 (${response.status})`, error.code ?? error.detail?.code ?? 'source_network'); }
 return response.json();
}
export type Payload = { empty: boolean; format: Exclude<LyricFormat, 'ass'>; content: string; metadata: Record<string, string[]>; translation?: string; romanization?: string; partial?: boolean };
export function parsePayload(payload: Payload) {
 if (payload.empty) throw new Error('此候选没有可用歌词');
 let partial = payload.partial === true;
 const lineTimedWords = new Set<string>();
 const document = importLyricFile(payload.content, payload.format, () => { partial = true; }, lineTimedWords);
 if (!document.lines.some(line=>line.words.some(word=>word.text.trim()))) throw new Error('此候选没有可用正文');
 document.metadata = { ...payload.metadata, ...document.metadata };
 for (const [text,kind] of [[payload.translation,'translation'],[payload.romanization,'romanization']] as const) {
   if (!text) continue;
   try { if (attachSidecar(document,text,kind).length) partial = true; }
   catch (error) { if (!(error instanceof Error)) throw error; partial = true; }
 }
 const badges = [payload.format.toUpperCase(), ...lyricCapabilities(document, lineTimedWords)];
 return { document, badges, partial };
}
