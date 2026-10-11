import { MessageBar, useNotice } from '../shared/MessageBar';
import { scopedSessionKey } from '../adapters/preferences';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { jobsApi } from '../adapters/http/jobs';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { useAudioReview } from './AudioReviewContext';
import { TopMenu } from './editor/TopMenu';
import editorStyles from './editor/semantic-editor.module.css';
import styles from './vocal.module.css';
export function VocalPanel({ locked, projectId, project, sourceAssetId, apply, durationMs, visible }: { locked?: boolean; projectId: string; project: ProjectDocument; sourceAssetId: string; apply: (command: ProjectCommand) => void; durationMs: number; visible: boolean }) {
  const ui = useAudioReview();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string|null>(null);
  const [notice, publish] = useNotice(), [issue, publishIssue] = useNotice(), [readError, publishReadError] = useNotice();
  const [cancelling, setCancelling] = useState(false);
  const submitting = useRef(false), cancelRequested = useRef(false);
  const [dismissed, setDismissed] = useState<string|null>(null);
  const intentKey=scopedSessionKey(`studio-vocal-intent-v1:${projectId}`);
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
  const adopted = sourceResults.find(r=>r.id===project.acoustics.analysisId);
  const adoptedAvailable = !!adopted && adopted.audio_state !== 'missing';
  const ready = !!project.acoustics.analysisId || project.acoustics.segments.length>0;
  const conflictVisible = !!conflict && dismissed !== latest?.id;
  useEffect(()=>ui.setTimelineReady(ready && !conflictVisible),[ready,conflictVisible,ui.setTimelineReady]);
  const showResult = () => {
    if (!latest || !['failed','cancelled','interrupted','succeeded'].includes(latest.status)) return;
    const success = latest.status === 'succeeded' || latest.status === 'cancelled';
    const text = latest.status === 'failed' ? '人声处理失败' : latest.status === 'interrupted' ? '服务重启，人声任务已中断' : latest.status === 'cancelled' ? '人声处理已取消' : '人声处理完成';
    publish(latest.error?.message ?? text, success ? 'status' : 'alert', success ? 4000 : undefined, latest.id);
    setDismissed(null);
  };
  useEffect(showResult, [latest?.id, latest?.status]);
  useEffect(()=>{publishIssue(error || null);},[error,publishIssue]);
  const readingFailed = jobs.isError || results.isError || completed.isError;
  useEffect(()=>{publishReadError(readingFailed ? '任务或结果读取失败，保留已知任务状态' : null);},[readingFailed,publishReadError]);
  useEffect(()=>{if(!active)setCancelling(false);},[active?.id]);
  const adopt = () => { if(locked)return;
    if(!pending || !result || result.status!=='ready') return;
    try {
      if(result.source_asset_id!==sourceAssetId)throw new Error('音源已改变，请重新发起人声处理');
      apply({type:'acoustics', acoustics:{analysisId:result.id,segments:result.segments!.map(s=>({...s}))},durationMs});
      handled.current.add(pending.id); setPending(null); setError('');
    } catch(e) {setError((e as Error).message);}
  };
  useEffect(()=>{
    if(pending && latest?.status==='succeeded' && result?.status==='ready' && !conflict && !handled.current.has(pending.id) && !error) adopt();
  },[pending,latest?.status,result,conflict,error]);
  const run = async (reuse?: string) => {
    if(locked)return;
    if (!sourceAssetId || submitting.current || active) return;
    submitting.current=true;cancelRequested.current=false;setCancelling(false);
    const baseline=JSON.stringify(project.acoustics);
    setBusy(true); setError(''); publish(null); setDismissed(null);
    try { const job=await jobsApi.createVocal(projectId, sourceAssetId, reuse); setPending({id:job.id,baseline}); if(cancelRequested.current) await jobsApi.cancel(job.id); await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] }); }
    catch(e) { setError(e instanceof Error ? e.message : '无法创建人声任务'); }
    finally { submitting.current=false; setBusy(false); }
  };
  const retryCpu = async () => {
    if(locked || submitting.current || active)return;
    if (!latest || !pending || pending.id !== latest.id || pending.baseline !== JSON.stringify(project.acoustics) || latest.request?.asset_id !== sourceAssetId) { setError('声学内容或本页应用意图已改变，请重新发起任务'); return; }
    if (!latest.request?.bound_revision) { setError('任务缺少可重试的项目版本'); return; }
    submitting.current=true; cancelRequested.current=false; setCancelling(false); setBusy(true); setError(''); publish(null);
    try { const job = await jobsApi.retryCpu(latest.id, latest.request.bound_revision); setPending({id:job.id, baseline:pending.baseline}); if(cancelRequested.current) await jobsApi.cancel(job.id); await jobs.refetch(); }
    catch(e) { setError((e as Error).message); }
    finally { submitting.current=false; setBusy(false); }
  };
  const retry=()=>void run(result?.id ?? latest?.request?.retry_analysis_id);
  const download=(id:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/vocals/${encodeURIComponent(id)}/file`;
  const cancel = async () => {
    if(cancelling)return;
    if(!active){cancelRequested.current=true;setCancelling(true);return;}
    setCancelling(true);setError('');
    try { await jobsApi.cancel(active.id); await jobs.refetch(); }
    catch(e) { setError(`取消请求失败：${(e as Error).message}`);setCancelling(false); }
  };
  const task = active;
  const deviceText = task?.request?.devices ? Object.entries(task.request.devices).map(([stage,device])=>`${stage==='vocal'?'人声分离':'自动对齐'}：${device.label}${device.reason ? `（${device.reason}）` : ''}`).join('；') : '';
  const status = { queued: '排队中', running: '处理中', cancel_requested: '正在取消，等待当前阶段结束', cancelled: '已取消', failed: '失败', interrupted: '服务重启，任务已中断', succeeded: '正在接入结果' };
  return <>
    {visible && <div className={editorStyles.ribbon} aria-label="音频操作">
      <div className={styles.segmentTools} ref={ui.setToolsHost}/>
      {ready ? <TopMenu id="audio-analysis" title="音频分析" className={editorStyles.ribbonMenu} activeMenuId={menu} onMenuChange={setMenu}>
        {(!currentAudio || repair || update) && <button data-role="inline" disabled={locked||busy||!!active} title="生成可用人声并分析，替换全部片段及人工修正" onClick={()=>void run()}>{repair?'重新生成人声':update?'更新人声分离结果':'分离人声'}</button>}
        {(repair||update) && <span>{repair?'人声文件缺失、损坏或存储版本不支持': '现有人声未匹配当前分离版本'}</span>}
        <button data-role="inline" disabled={locked||busy||!!active||!adoptedAvailable} title="复用现有人声，替换全部片段及人工修正" onClick={()=>void run(project.acoustics.analysisId!)}>重新进行声学分析</button>
        {adoptedAvailable && project.acoustics.analysisId && <a data-role="secondary" href={download(project.acoustics.analysisId)} download>下载人声 WAV</a>}
      </TopMenu> : <button data-role="primary" disabled={locked||busy||!!active} onClick={()=>void run()}>{repair?'重新生成人声':update?'更新人声分离结果':currentAudio?'使用已有人声':'分离人声'}</button>}
      {latest && !active && <button data-role="inline" onClick={showResult}>查看最近处理结果</button>}
      <div className={styles.alignmentTools} ref={ui.setAlignmentHost}/>
    </div>}
    {ui.taskHost && (active || busy) && createPortal(<MessageBar notice={{ text: `人声处理 · ${task ? cancelling ? '正在取消' : status[task.status] : '正在准备'}${task?.stage ? ` · ${{separating:'分离人声',analyzing:'声学分析'}[task.stage] ?? task.stage}` : ''}${deviceText ? ` · ${deviceText}` : ''}`, role:'status', origin:null, dismissible:false }} actions={<button data-role="secondary" disabled={cancelling || active?.status==='cancel_requested'} onClick={()=>void cancel()}>取消任务</button>}/>,ui.taskHost)}
    {ui.messageHost && createPortal(<>
      <MessageBar notice={notice} actions={notice?.taskId===latest?.id && failure && latest.status!=='cancelled' ? <>
        <button data-role="secondary" disabled={locked||busy||!!active} onClick={retry}>重试</button>
        {latest.error?.cpu_retry && <button data-role="secondary" disabled={locked||busy||!!active} onClick={()=>void retryCpu()}>使用 CPU 重试</button>}
      </> : undefined}/>
      <MessageBar notice={issue} actions={!active && !busy ? <button data-role="secondary" disabled={locked} onClick={()=>{if(pending && result?.status==='ready' && latest?.status==='succeeded')setError('');else retry();}}>重试</button> : undefined}/>
      <MessageBar notice={readError} actions={<button data-role="secondary" onClick={()=>{void jobs.refetch();void results.refetch();if(completed.isError)void completed.refetch();}}>重试读取</button>}/>
    </>,ui.messageHost)}
    {ui.statusHost && (conflictVisible || !ready) && createPortal(<section className={styles.panel} aria-label="音频处理结果">
      {conflictVisible ? <><p>声学内容已改变，本次结果已保留。</p><button data-role="primary" disabled={locked} onClick={adopt}>替换当前片段</button>{ready && <button data-role="secondary" onClick={()=>setDismissed(latest!.id)}>返回上次结果</button>}</> : <p>{active||busy?'正在处理音频，可在上方查看任务状态。':'尚无可用片段，请通过音频工具分离人声。'}</p>}
    </section>,ui.statusHost)}
  </>;
}
