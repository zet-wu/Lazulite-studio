import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { jobsApi } from '../adapters/http/jobs';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { useAudioReview } from './AudioReviewContext';
import { TopMenu } from './editor/TopMenu';
import { IconButton } from '../shared/Controls';
import editorStyles from './editor/semantic-editor.module.css';
import styles from './vocal.module.css';
export function VocalPanel({ projectId, project, sourceAssetId, apply, durationMs, visible }: { projectId: string; project: ProjectDocument; sourceAssetId: string; apply: (command: ProjectCommand) => void; durationMs: number; visible: boolean }) {
  const ui = useAudioReview();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string|null>(null);
  const [dismissed, setDismissed] = useState<string|null>(null);
  const intentKey=`studio-vocal-intent-v1:${projectId}`;
  const [pending, setPending] = useState<{id:string; baseline:string}|null>(()=>{
    const saved=sessionStorage.getItem(intentKey);
    return saved?JSON.parse(saved):null;
  });
  useEffect(()=>{if(pending)sessionStorage.setItem(intentKey,JSON.stringify(pending));else sessionStorage.removeItem(intentKey);},[intentKey,pending]);
  const handled = useRef(new Set<string>());
  const jobs = useQuery({ queryKey: ['vocal-jobs', projectId], queryFn: () => jobsApi.list(projectId), refetchInterval: 1000 });
  const results = useQuery({ queryKey: ['vocals', projectId], queryFn: () => vocalApi.list(projectId), refetchInterval: 1000 });
  const tasks = jobs.data?.items.filter(j => j.kind === 'vocal') ?? [];
  const active = tasks.find(j => ['queued','running','cancel_requested'].includes(j.status));
  const latest = pending ? tasks.find(j=>j.id===pending.id) : tasks[0];
  const completed = useQuery({queryKey:['vocal-result',latest?.id], queryFn:()=>vocalApi.jobResult(latest!.id), enabled:latest?.status==='succeeded'});
  const result = results.data?.items.find(r=>r.id===(completed.data?.analysis_id ?? latest?.id));
  const sourceResults = results.data?.items.filter(r=>r.source_asset_id===sourceAssetId) ?? [];
  const currentAudio = sourceResults.find(r=>r.audio_state==='current') ?? sourceResults[0];
  const repair = currentAudio?.audio_state==='missing';
  const update = currentAudio?.audio_state==='outdated';
  const failure = latest && ['failed','cancelled','interrupted'].includes(latest.status);
  const conflict = pending && latest?.status==='succeeded' && !handled.current.has(pending.id) && pending.baseline!==JSON.stringify(project.acoustics);
  const ready = !!project.acoustics.analysisId || project.acoustics.segments.length>0;
  const showing = busy || !!active || !!error || jobs.isError || results.isError || completed.isError || !!conflict || !!(failure && dismissed!==latest.id);
  useEffect(()=>ui.setTimelineReady(ready && !showing),[ready,showing,ui.setTimelineReady]);
  const adopt = () => {
    if(!pending || !result || result.status!=='ready') return;
    try {
      apply({type:'acoustics', acoustics:{analysisId:result.id,segments:result.segments!.map(s=>({...s}))},durationMs});
      handled.current.add(pending.id); setPending(null); setError('');
    } catch(e) {setError((e as Error).message);}
  };
  useEffect(()=>{
    if(pending && latest?.status==='succeeded' && result?.status==='ready' && !conflict && !handled.current.has(pending.id) && !error) adopt();
  },[pending,latest?.status,result,conflict,error]);
  const run = async (reuse?: string) => {
    if (!sourceAssetId || busy || active) return;
    const baseline=JSON.stringify(project.acoustics);
    setBusy(true); setError(''); setDismissed(null);
    try { const job=await jobsApi.createVocal(projectId, sourceAssetId, reuse); setPending({id:job.id,baseline}); await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] }); }
    catch(e) { setError(e instanceof Error ? e.message : '无法创建人声任务'); }
    finally { setBusy(false); }
  };
  const retry=()=>void run(result?.id ?? latest?.request?.retry_analysis_id);
  const download=(id:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/vocals/${encodeURIComponent(id)}/file`;
  const status = { queued: '排队中', running: '处理中', cancel_requested: '正在取消，等待当前阶段结束', cancelled: '已取消', failed: '失败', interrupted: '服务重启，任务已中断', succeeded: '正在接入结果' };
  return <>
    {visible && <div className={editorStyles.ribbon} aria-label="音频操作">
      {ready && !showing && <div className={styles.segmentTools} ref={ui.setToolsHost}/>}
      {ready ? <TopMenu id="audio-analysis" title="音频分析" className={editorStyles.ribbonMenu} activeMenuId={menu} onMenuChange={setMenu}>
        {(!currentAudio || repair || update) && <button data-role="inline" disabled={busy||!!active} title="生成可用人声并分析，替换全部片段及人工修正" onClick={()=>void run()}>{repair?'重新生成人声':update?'更新人声分离结果':'分离人声'}</button>}
        {(repair||update) && <span>{repair?'人声文件缺失或损坏': '现有人声未匹配当前分离版本'}</span>}
        <button data-role="inline" disabled={busy||!!active||!project.acoustics.analysisId} title="复用现有人声，替换全部片段及人工修正" onClick={()=>void run(project.acoustics.analysisId!)}>重新进行声学分析</button>
        {project.acoustics.analysisId && <a data-role="secondary" href={download(project.acoustics.analysisId)} download>下载人声 FLAC</a>}
        {failure && <button data-role="inline" onClick={()=>setDismissed(null)}>查看最近处理结果</button>}
      </TopMenu> : <button data-role="primary" disabled={busy||!!active} onClick={()=>void run()}>{repair?'重新生成人声':update?'更新人声分离结果':currentAudio?'使用已有人声':'分离人声'}</button>}
    </div>}
    {ui.statusHost && showing && createPortal(<section className={styles.panel} aria-label="音频处理状态">
      {latest && <p role="status">{status[latest.status]}{latest.stage ? ` · ${{separating:'分离人声',analyzing:'声学分析'}[latest.stage]??latest.stage}`:''}</p>}
      {(error||latest?.error||jobs.isError||results.isError||completed.isError) && <p role="alert">{error||latest?.error?.message||'任务或结果读取失败'}</p>}
      {(jobs.isError||results.isError||completed.isError) && <button data-role="secondary" onClick={()=>{void jobs.refetch();void results.refetch();if(completed.isError)void completed.refetch();}}>重试读取</button>}
      {active && <button data-role="secondary" disabled={active.status==='cancel_requested'} onClick={()=>void jobsApi.cancel(active.id).then(()=>jobs.refetch()).catch(e=>setError(e.message))}>取消任务</button>}
      {conflict && <p role="alert">声学内容已改变，本次结果已保留。<button data-role="primary" onClick={adopt}>替换当前片段</button></p>}
      {!active && !busy && !conflict && !jobs.isError && !results.isError && !completed.isError && <>
        {ready && <IconButton icon="back" label="返回上次结果" onClick={()=>{setDismissed(latest?.id??null);setError('');}}/>}
        <button data-role="secondary" onClick={retry}>重试</button>
        {result && <a data-role="secondary" href={download(result.id)} download>下载本次人声 FLAC</a>}
      </>}
    </section>,ui.statusHost)}
  </>;
}
