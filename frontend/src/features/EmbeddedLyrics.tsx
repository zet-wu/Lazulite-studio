import { parsePayload } from '../adapters/http/lyric-sources';
import { LyricCandidate } from './LyricCandidate';
import styles from './acquisition.module.css';
import { useEffect, useState } from 'react';
import { requestHeaders } from '../adapters/http/client';
import type { LyricFormat } from '../adapters/lyric-formats';
type Candidate = { id: string; label: string; format?: Exclude<LyricFormat, 'ass'>; content?: string; error?: string; badges?: string[] };
export function EmbeddedLyrics({ projectId, sourceAssetId, onPreview }: { projectId?: string; sourceAssetId?: string | null; onPreview: (content: string, format: Exclude<LyricFormat, 'ass'>) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setCandidates([]); setSelected(null);
    if (!projectId || !sourceAssetId) { setMessage('请先上传音乐文件。'); return; }
    const controller = new AbortController();
    setMessage('正在读取原始音乐的内嵌歌词…');
    void (async () => {
      try {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/embedded-lyrics`, { credentials: 'include', headers: requestHeaders(), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message ?? data.message ?? '内嵌歌词读取失败');
        if (data.asset_id !== sourceAssetId) throw new Error('音乐文件已变化，请重新打开内嵌来源。');
        if (controller.signal.aborted) return;
        setCandidates(data.candidates.map((candidate: Candidate) => {
          if (candidate.error) return candidate;
          try {
            if (!candidate.format || candidate.content === undefined) throw new Error('缺少歌词格式或正文');
            const parsed = parsePayload({empty:false,format:candidate.format,content:candidate.content,metadata:{}});
            return {...candidate,badges:parsed.badges};
          } catch (error) { return {...candidate,error:`正文解析失败：${error instanceof Error ? error.message : String(error)}`}; }
        })); setMessage(data.candidates.length ? '选择一项预览；确认导入后才会替换当前歌词。' : '原始音乐中没有内嵌歌词。');
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '内嵌歌词读取失败'); }
    })();
    return () => controller.abort();
  }, [projectId, sourceAssetId]);
  return <section aria-label="内嵌歌词"><p role="status">{message}</p><div className={styles.results} aria-label="内嵌候选">{candidates.map(candidate =>
    <LyricCandidate key={candidate.id} title={candidate.label} badges={candidate.badges ?? []} status={candidate.error}
      failed={!!candidate.error} disabled={!!candidate.error} selected={selected===candidate.id}
      onSelect={() => { setSelected(candidate.id); onPreview(candidate.content!, candidate.format!); }}/>
  )}</div></section>;
}
