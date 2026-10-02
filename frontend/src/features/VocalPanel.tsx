import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { jobsApi } from '../adapters/http/jobs';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import styles from './vocal.module.css';
export function VocalPanel({ projectId, project, apply, durationMs }: { projectId: string; project: ProjectDocument; apply: (command: ProjectCommand) => void; durationMs: number }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = useQuery({ queryKey: ['vocal-jobs', projectId], queryFn: () => jobsApi.list(projectId), refetchInterval: 1500 });
  const results = useQuery({ queryKey: ['vocals', projectId], queryFn: () => vocalApi.list(projectId), refetchInterval: 1500 });
  const tasks = jobs.data?.items.filter(j => j.kind === 'vocal') ?? [];
  const active = tasks.find(j => ['queued','running','cancel_requested'].includes(j.status));
  const run = async (retry?: string) => {
    if (!project.sourceAssetId) return;
    setBusy(true); setError('');
    try { await jobsApi.createVocal(projectId, project.sourceAssetId, retry); await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] }); }
    catch(e) { setError(e instanceof Error ? e.message : '无法创建人声任务'); }
    finally { setBusy(false); }
  };
  const status = { queued: '排队中', running: '处理中', cancel_requested: '正在取消，等待当前阶段结束', cancelled: '已取消', failed: '失败', interrupted: '服务重启，任务已中断', succeeded: '已完成' };
  return <section className={styles.panel} aria-label="人声分离与声学分析">
    <div className={styles.toolbar}><strong>人声分离与声学分析</strong><button data-role="primary" disabled={busy || !!active} onClick={() => void run()}>进行人声分离及声学分析</button></div>
    <p>人声片段来自声学分析，供人工定位参考；采用结果不会修改歌词时间。</p>
    {(error || jobs.isError || results.isError) && <p role="alert">{error || '任务或结果读取失败'} <button data-role="secondary" onClick={() => { void jobs.refetch(); void results.refetch(); }}>重试读取</button></p>}
    {tasks.slice(0, 5).map(job => <div className={styles.task} key={job.id}><span>{status[job.status]}{job.stage ? ` · ${{separating:'分离人声',analyzing:'声学分析'}[job.stage] ?? job.stage}` : ''}</span>{job.error && <span role="alert">{job.error.message}</span>}{['queued','running'].includes(job.status) && <button data-role="secondary" onClick={() => void jobsApi.cancel(job.id).then(() => jobs.refetch()).catch(e => setError(e.message))}>取消任务</button>}</div>)}
    {results.data?.items.map((result, i) => <div className={styles.task} key={result.id}><span>人声结果 {results.data.items.length-i} · {result.status === 'ready' ? `${result.segments?.length ?? 0} 个片段` : '分离完成，分析未完成'}{project.acoustics.analysisId === result.id ? ' · 当前采用' : ''}</span>{result.status === 'ready' ? <button data-role="secondary" disabled={project.acoustics.analysisId === result.id} onClick={() => { try { apply({ type:'acoustics', acoustics:{analysisId:result.id,segments:result.segments!.map(s=>({...s}))}, durationMs }); setError(''); } catch(e) { setError((e as Error).message); } }}>采用</button> : <button data-role="secondary" disabled={busy || !!active} onClick={() => void run(result.id)}>重试声学分析</button>}<a href={`/api/v1/projects/${encodeURIComponent(projectId)}/vocals/${encodeURIComponent(result.id)}/file`} download>下载人声 FLAC</a></div>)}
  </section>;
}
