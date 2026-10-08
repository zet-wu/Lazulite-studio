import { useEffect, useState } from 'react';
import { requestHeaders } from '../adapters/http/client';
import type { LyricFormat } from '../adapters/lyric-formats';
type Candidate = { id: string; label: string; format?: Exclude<LyricFormat, 'ass'>; content?: string; error?: string };
export function EmbeddedLyrics({ projectId, sourceAssetId, onPreview }: { projectId?: string; sourceAssetId?: string | null; onPreview: (content: string, format: Exclude<LyricFormat, 'ass'>) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setCandidates([]);
    if (!projectId || !sourceAssetId) { setMessage('请先上传音乐文件。'); return; }
    const controller = new AbortController();
    setMessage('正在读取原始音乐的内嵌歌词…');
    void (async () => {
      try {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/embedded-lyrics`, { credentials: 'include', headers: requestHeaders(), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message ?? data.message ?? '内嵌歌词读取失败');
        if (data.asset_id !== sourceAssetId) throw new Error('音乐文件已变化，请重新打开内嵌来源。');
        setCandidates(data.candidates); setMessage(data.candidates.length ? '选择一项预览；确认导入后才会替换当前歌词。' : '原始音乐中没有内嵌歌词。');
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '内嵌歌词读取失败'); }
    })();
    return () => controller.abort();
  }, [projectId, sourceAssetId]);
  return <section aria-label="内嵌歌词"><p role="status">{message}</p><ul>{candidates.map(candidate => <li key={candidate.id}>
    <button data-role="secondary" disabled={!!candidate.error} onClick={() => onPreview(candidate.content!, candidate.format!)}>{candidate.label}</button>
    {candidate.error && <p>{candidate.error}</p>}
  </li>)}</ul></section>;
}
