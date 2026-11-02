import { message as describeMessage, messageList, MessageError, errorMessage, type Message } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { deviceSummary, taskError } from './task-messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { intersectSegments } from '../domain/time-boundaries';
import { useProjectJobs } from './useProjectJobs';
import { IconButton } from '../shared/Controls';
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
export function VocalPanel({ locked, projectId, project, sourceAssetId, apply, durationMs, visible }: { locked?: boolean; projectId: string; project: ProjectDocument; sourceAssetId: string; apply: (command: ProjectCommand) => void; durationMs: number | null; visible: boolean }) {
  useTranslation();
  const ui = useAudioReview();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string|Message>('');
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
  const jobs = useProjectJobs(projectId,visible);
  const hasActive=jobs.data?.items.some(job=>['queued','running','cancel_requested'].includes(job.status));
  const results = useQuery({ queryKey: ['vocals', projectId], queryFn: () => vocalApi.list(projectId), refetchInterval: hasActive ? 1000 : 15000, refetchOnWindowFocus: 'always' });
  useEffect(()=>{if(visible)void results.refetch();},[projectId,visible]);
  const tasks = jobs.data?.items.filter(j => j.kind === 'vocal') ?? [];
  const active = tasks.find(j => ['queued','running','cancel_requested'].includes(j.status));
  const latest = pending ? tasks.find(j=>j.id===pending.id) : tasks[0];
  const completed = useQuery({queryKey:['vocal-result',latest?.id], queryFn:()=>vocalApi.jobResult(latest!.id), enabled:latest?.status==='succeeded'});
  useEffect(()=>{if(latest && ['succeeded','failed','cancelled','interrupted'].includes(latest.status))void results.refetch();},[latest?.id,latest?.status]);
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
  useEffect(() => {
    if (!latest || !['failed','cancelled','interrupted','succeeded'].includes(latest.status)) return;
    const success = latest.status === 'succeeded' || latest.status === 'cancelled';
    const text=describeMessage(latest.status==='failed'?'vocal.failed':latest.status==='interrupted'?'vocal.interrupted':latest.status==='cancelled'?'vocal.cancelled':'vocal.completed');
    publish(latest.error ? taskError(latest.error) : text, success ? 'status' : 'alert', success ? 4000 : undefined, latest.id);
    setDismissed(null);
  }, [latest?.id, latest?.status]);
  useEffect(()=>{publishIssue(error || null);},[error,publishIssue]);
  const readingFailed = jobs.isError || results.isError || completed.isError;
  useEffect(()=>{publishReadError(readingFailed ? describeMessage('vocal.readFailed') : null);},[readingFailed,publishReadError]);
  useEffect(()=>{if(!active)setCancelling(false);},[active?.id]);
  const adopt = () => { if(locked)return;
    if(!pending || !result || result.status!=='ready') return;
    try {
      if (durationMs === null) throw new MessageError(describeMessage('vocal.durationUnknown'));
      if(result.source_asset_id!==sourceAssetId)throw new MessageError(describeMessage('vocal.sourceChanged'));
      const normalized = intersectSegments(result.segments!, durationMs);
      apply({type:'acoustics', acoustics:{analysisId:result.id,segments:normalized.segments}});
      if(normalized.clipped || normalized.dropped) publish(describeMessage('task.normalized',{clipped:normalized.clipped,dropped:normalized.dropped}), 'status');
      handled.current.add(pending.id); setPending(null); setError('');
    } catch(e) {setError(errorMessage(e));}
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
    catch(e) { setError(errorMessage(e)); }
    finally { submitting.current=false; setBusy(false); }
  };
  const retryCpu = async () => {
    if(locked || submitting.current || active)return;
    if (!latest || !pending || pending.id !== latest.id || pending.baseline !== JSON.stringify(project.acoustics) || latest.request?.asset_id !== sourceAssetId) { setError(describeMessage('vocal.intentChanged')); return; }
    if (!latest.request?.bound_revision) { setError(describeMessage('vocal.noRetryRevision')); return; }
    submitting.current=true; cancelRequested.current=false; setCancelling(false); setBusy(true); setError(''); publish(null);
    try { const job = await jobsApi.retryCpu(latest.id, latest.request.bound_revision); setPending({id:job.id, baseline:pending.baseline}); if(cancelRequested.current) await jobsApi.cancel(job.id); await jobs.refetch(); }
    catch(e) { setError(errorMessage(e)); }
    finally { submitting.current=false; setBusy(false); }
  };
  const retry=()=>void run(result?.id ?? latest?.request?.retry_analysis_id);
  const download=(id:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/vocals/${encodeURIComponent(id)}/file`;
  const cancel = async () => {
    if(cancelling)return;
    if(!active){cancelRequested.current=true;setCancelling(true);return;}
    setCancelling(true);setError('');
    try { await jobsApi.cancel(active.id); await jobs.refetch(); }
    catch(e) { setError(describeMessage('task.cancelFailed',{diagnostic:(e as Error).message}));setCancelling(false); }
  };
  const task = active;
  const deviceText=deviceSummary(task?.request?.devices);
  const status = { queued: t('task.queued'), running: t('task.processing'), cancel_requested: t('task.waitingCancel'), cancelled: t('task.cancelled'), failed: t('task.failed'), interrupted: t('task.interrupted'), succeeded: t('task.applying') };
  return <>
    {visible && ui.analysisHost && createPortal(<>
      {ready ? <TopMenu id="audio-analysis" title={t('vocal.analysis')} className={editorStyles.ribbonMenu} activeMenuId={menu} onMenuChange={setMenu}>
        {(!currentAudio || repair || update) && <button data-role="inline" disabled={locked||busy||!!active} title={t('vocal.replaceHelp')} onClick={()=>void run()}>{repair?t('vocal.regenerate'):update?t('vocal.updateSeparation'):t('vocal.separate')}</button>}
        {(repair||update) && <span>{repair?t('vocal.fileUnavailable'): t('vocal.versionMismatch')}</span>}
        <button data-role="inline" disabled={locked||busy||!!active||!adoptedAvailable} title={t('vocal.reuseHelp')} onClick={()=>void run(project.acoustics.analysisId!)}>{t('vocal.reanalyze')}</button>
        {adoptedAvailable && project.acoustics.analysisId && <a data-role="secondary" href={download(project.acoustics.analysisId)} download>{t('vocal.download')}</a>}
      </TopMenu> : <button data-role="primary" disabled={locked||busy||!!active} onClick={()=>void run()}>{repair?t('vocal.regenerate'):update?t('vocal.updateSeparation'):currentAudio?t('vocal.useExisting'):t('vocal.separate')}</button>}
    </>, ui.analysisHost)}
    {ui.taskHost && (active || busy) && createPortal(<MessageBar notice={{ text: t('task.vocalProgress',{progress:`${task ? cancelling ? t('task.cancelling') : status[task.status] : t('task.preparing')}${task?.stage ? ` · ${{separating:t('vocal.separate'),analyzing:t('vocal.acousticAnalysis')}[task.stage] ?? task.stage}` : ''}`,device:deviceText?' · '+deviceText:''}), role:'status', origin:null, dismissible:false }} actions={<button data-role="secondary" disabled={cancelling || active?.status==='cancel_requested'} onClick={()=>void cancel()}>{t('task.cancel')}</button>}/>,ui.taskHost)}
    {ui.messageHost && createPortal(<>
      <MessageBar notice={notice} actions={notice?.taskId===latest?.id && failure && latest.status!=='cancelled' ? <>
        <IconButton icon="refresh" label={t('vocal.retry')} data-role="secondary" disabled={locked||busy||!!active} onClick={retry}/>
        {latest.error?.cpu_retry && <button data-role="secondary" disabled={locked||busy||!!active} onClick={()=>void retryCpu()}>{t('task.retryCpu')}</button>}
      </> : undefined}/>
      <MessageBar notice={issue} actions={!active && !busy ? <IconButton icon="refresh" label={t('vocal.retry')} data-role="secondary" disabled={locked} onClick={()=>{if(pending && result?.status==='ready' && latest?.status==='succeeded')setError('');else retry();}}/> : undefined}/>
      <MessageBar notice={readError} actions={<IconButton icon="refresh" label={t('vocal.retryRead')} data-role="secondary" onClick={()=>{void jobs.refetch();void results.refetch();if(completed.isError)void completed.refetch();}}/>}/>
    </>,ui.messageHost)}
    {ui.statusHost && (conflictVisible || !ready) && createPortal(<section className={styles.panel} aria-label={t('vocal.results')}>
      {conflictVisible ? <><p>{t('vocal.changed')}</p><button data-role="primary" disabled={locked} onClick={adopt}>{t('vocal.replaceSegments')}</button>{ready && <button data-role="secondary" onClick={()=>setDismissed(latest!.id)}>{t('vocal.previous')}</button>}</> : <p>{active||busy?t('vocal.runningHelp'):t('vocal.empty')}</p>}
    </section>,ui.statusHost)}
  </>;
}

const t=i18n.t.bind(i18n);
