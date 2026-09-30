import { requestHeaders } from './client';
import { importLyricFile, type LyricFormat } from '../lyric-formats';
import { attachSidecar } from '../source-codec';
export type Source = 'netease' | 'qqmusic' | 'kugou' | 'amll';
export type Candidate = { source: Source; id: string; title: string; artists: string[]; album: string; duration_ms: number | null; songmid?: string | null; songid?: string | null; platform?: string | null; file?: string | null };
export async function sourceRequest<T>(action: 'search' | 'fetch' | 'resolve', body: unknown, signal?: AbortSignal): Promise<T> {
 const response = await fetch(`/api/v1/lyric-sources/${action}`, { method: 'POST', credentials: 'include', signal, headers: requestHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
 if (!response.ok) { const error = await response.json(); throw new Error(response.status === 401 ? '在线获取需要登录服务，请先从项目列表登录。' : error.message ?? error.detail?.message ?? `请求失败 (${response.status})`); }
 return response.json();
}
export type Payload = { empty: boolean; format: Exclude<LyricFormat, 'ass'>; content: string; metadata: Record<string, string[]>; translation?: string; romanization?: string };
export function parsePayload(payload: Payload) {
 if (payload.empty) throw new Error('此候选没有可用歌词');
 const document = importLyricFile(payload.content, payload.format);
 document.metadata = { ...payload.metadata, ...document.metadata };
 const issues = [...attachSidecar(document, payload.translation ?? '', 'translation'), ...attachSidecar(document, payload.romanization ?? '', 'romanization')];
 // Do not silently lose unmatched source sidecars on import.
 if (issues.length) throw new Error(`附属内容无法无损对应，请检查来源：${issues.join('；')}`);
 const words = document.lines.flatMap(l => l.words);
 const badges = [words.some(w => w.beginUs !== null) ? (document.lines.some(l => l.words.filter(w => w.beginUs !== null).length > 1) ? '逐词' : '逐行') : '无时间', payload.format.toUpperCase()];
 if (document.lines.some(l => l.translations.length)) badges.push('翻译');
 if (document.romanizationTracks.length) badges.push('音译');
 if (words.some(w => w.rubyUnits.length)) badges.push('Ruby');
 return { document, badges };
}
