import { message as describeMessage, messageList, MessageError, errorMessage, type Message } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { deviceSummary, taskError } from './task-messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useProjectJobs } from './useProjectJobs';
import { IconButton } from '../shared/Controls';
import { MessageBar, useNotice, type Notice } from '../shared/MessageBar';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { alignmentApi, defaultAlignmentOptions, type AlignmentSummary } from '../adapters/http/alignment';
import { jobsApi, type JobRequest } from '../adapters/http/jobs';
import { studioS4 } from '../adapters/http/client';
import { mergeAlignment } from '../domain/alignment';
import type { ProjectDocument } from '../domain/project-document';
import styles from './alignment.module.css';
import { SettingsDialog } from './editor/SettingsDialog';
import { useAudioReview } from './AudioReviewContext';

export type AlignmentControl = {
  locked: boolean;
  lock: () => { source: ProjectDocument; release: () => void; apply: (project: ProjectDocument) => void };
  save: () => Promise<{revision:string} | undefined>;
};
export function AlignmentPanel({pid, assetId, durationMs, project, control, visible, finishDraft}: {
  pid:string; assetId?:string; durationMs:number|null; project:ProjectDocument; control:AlignmentControl; visible:boolean; finishDraft:()=>boolean;
}) {
  useTranslation();
  const ui=useAudioReview();
  const caps=useQuery({queryKey:['capabilities'],queryFn:()=>jobsApi.capabilities()});
  const jobs=useProjectJobs(pid,visible);
  const [dialog,setDialog]=useState(false),[options,setOptions]=useState(defaultAlignmentOptions),[summary,setSummary]=useState<AlignmentSummary|null>(null);
  const [gapDraft,setGapDraft]=useState('500'),[gapError,setGapError]=useMessageText('');
  const gapId=useId(),gapErrorId=useId();
  const [message,setMessage]=useNotice();
  const [connection,setConnection]=useNotice();
  const recent = useRef<Notice | null>(null);
  const resultMessage = (text: string|Message, role: Notice['role'] = 'alert', timeout?: number, taskId?: string) => {
    recent.current = setMessage(text, role, timeout, taskId);
  };
  const [cpuFailure,setCpuFailure] = useState<{id:string; source:string; revision:string; options:ReturnType<typeof defaultAlignmentOptions>}|null>(null);
  const [devices,setDevices] = useState<JobRequest['devices']>();
  const deviceText=deviceSummary(devices);
  const [progress,setProgress]=useMessageText('');
  const [running,setRunning]=useState(false),[cancelling,setCancelling]=useState(false);
  const [opening,setOpening]=useState(false);
  const operation=useRef<{alive:boolean; id?:string; cancel:boolean; lock:ReturnType<AlignmentControl['lock']>}|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    const leave=()=>{const op=operation.current;if(op){op.alive=false;op.cancel=true;op.lock.release();if(op.id)void alignmentApi.cancel(op.id).catch(()=>undefined);}};
    window.addEventListener('pagehide',leave);
    return()=>{mounted.current=false;leave();window.removeEventListener('pagehide',leave);};
  },[pid]);
  const capability=caps.data?.items.find(c=>c.id==='job.alignment');
  const active=jobs.data?.items.some(j=>['vocal','alignment'].includes(j.kind)&&['queued','running','cancel_requested'].includes(j.status));
  const reason=!assetId?t('alignment.uploadRequired'):durationMs===null?t('alignment.durationUnknown'):!project.lyrics.lines.some(l=>!project.editing.skippedAlignmentLineIds.includes(l.id))?t('alignment.noLines'):!capability?.enabled?(capability?.reason??t('alignment.checkingModels')):active?t('alignment.busy'):null;
  const open=async()=>{
    if(!finishDraft())return;
    setOpening(true);setMessage('');setOptions(defaultAlignmentOptions());setGapDraft('500');setGapError('');
    try {const saved=await control.save();if(!saved)throw new MessageError(describeMessage('alignment.saveRequired'));const data=await alignmentApi.preview(pid,saved.revision);if(mounted.current){setSummary(data);setDialog(true);}}
    catch(e){setMessage(errorMessage(e));}finally{if(mounted.current)setOpening(false);}
  };
  const start=async(retryCpu = false)=>{
    if (operation.current) return;
    const threshold=options.merge_short_gaps?Number(gapDraft):500;
    if(options.merge_short_gaps && (!gapDraft.trim() || !Number.isSafeInteger(threshold) || threshold<=0)){setGapError(describeMessage('alignment.gapRange'));return;}
    const failed = retryCpu ? cpuFailure : null;
    if (retryCpu && (!failed || failed.source !== JSON.stringify(project))) { setMessage(describeMessage('alignment.intentChanged')); return; }
    const selected = failed?.options ?? {...options,gap_threshold_ms:threshold};
    setDialog(false);setRunning(true);setCancelling(false);setMessage('');setConnection('');setDevices(undefined);recent.current=null;setProgress(describeMessage('task.preparing'));
    let lock:ReturnType<AlignmentControl['lock']>;
    try{lock=control.lock();}catch(e){setMessage(errorMessage(e));setRunning(false);return;}
    const op={alive:true,cancel:false,id:undefined as string|undefined,lock};operation.current=op;
    try {
      const saved=await control.save();if(!saved)throw new MessageError(describeMessage('alignment.revisionUnknown'));
      if(!op.alive||op.cancel){if(op.alive)setMessage(describeMessage('alignment.cancelled'),'status',4000);return;}
      if (failed && saved.revision !== failed.revision) throw new MessageError(describeMessage('alignment.revisionChanged'));
      setCpuFailure(null);
      const key=crypto.randomUUID();
      // A lost launch response is retried with the same key, never a second model execution.
      let job;
      try {job=failed ? await jobsApi.retryCpu(failed.id,saved.revision,key) : await alignmentApi.start(pid,saved.revision,selected,key);}
      catch(e){if(e instanceof TypeError)job=failed ? await jobsApi.retryCpu(failed.id,saved.revision,key) : await alignmentApi.start(pid,saved.revision,selected,key);else throw e;}
      op.id=job.id;
      if(!op.alive){void alignmentApi.cancel(job.id).catch(()=>undefined);return;}
      if(op.cancel) await alignmentApi.cancel(job.id).catch(e=>{setCancelling(false);setConnection(describeMessage('task.cancelFailed',{diagnostic:e.message}));});
      let disconnected = false;
      while(op.alive){
        if(job.request?.devices)setDevices(job.request.devices);
        if(job.status==='failed'&&job.error?.cpu_retry)setCpuFailure({id:job.id,source:JSON.stringify(op.lock.source),revision:saved.revision,options:selected});
        if(job.status==='succeeded'){
          if(op.cancel){setMessage(describeMessage('alignment.applyCancelled'),'status',4000);break;}
          const result=await alignmentApi.result(job.id);
          const current=await studioS4.getDocumentEnvelope(pid);
          if(!op.alive||op.cancel){if(op.alive)setMessage(describeMessage('alignment.applyCancelled'),'status',4000);break;}
          if(current.revision!==saved.revision || result.binding.revision!==saved.revision || result.binding.project_id!==pid || result.binding.asset_id!==assetId)throw new MessageError(describeMessage('alignment.sourceChanged'));
          if (durationMs === null) throw new MessageError(describeMessage('alignment.resultDurationUnknown'));
          const merged=mergeAlignment(op.lock.source,result,durationMs,selected.clear_unmatched,selected.merge_short_gaps?selected.gap_threshold_ms:null);op.lock.apply(merged.project);

          resultMessage(messageList([
            ...(result.normalization&&(result.normalization.clipped||result.normalization.dropped)?[describeMessage('task.normalized',{clipped:result.normalization.clipped,dropped:result.normalization.dropped})]:[]),
            describeMessage(merged.project===op.lock.source?'alignment.noChanges':'alignment.updated'),
            ...(merged.mergedGaps?[describeMessage('alignment.mergedGaps',{count:merged.mergedGaps})]:[]),
            ...(merged.cleared.length?[describeMessage('alignment.cleared',{count:merged.cleared.length})]:[]),
            ...(merged.retained.length?[describeMessage('alignment.retained',{count:merged.retained.length})]:[]),
          ]), 'status', merged.retained.length||merged.cleared.length?8000:4000);break;
        }
        if(['failed','cancelled','interrupted'].includes(job.status)){resultMessage(job.error?taskError(job.error):(job.status==='cancelled'?describeMessage('alignment.cancelled'):describeMessage('task.interruptedRetry')), job.status==='cancelled'?'status':'alert', job.status==='cancelled'?4000:undefined,job.id);break;}
        if(job.status==='cancel_requested'){op.cancel=true;setCancelling(true);}
        setProgress(op.cancel?describeMessage('task.cancelling'):job.status==='queued'?describeMessage('task.queued'):({separating:describeMessage('task.separating'),analyzing:describeMessage('task.analyzingRegions'),acoustic:describeMessage('task.probabilities'),decode:describeMessage('task.globalAlignment')}[job.stage??'']??describeMessage('task.aligning')));
        await new Promise(resolve=>setTimeout(resolve,700));
        if(!op.alive)break;
        try { job=await alignmentApi.state(job.id); if(disconnected){setConnection('');disconnected=false;} }
        catch(e) {
          if(!disconnected) setConnection(describeMessage('task.reconnecting',{diagnostic:(e as Error).message}));
          disconnected=true;
          // The last observed task and lock remain authoritative until a terminal state arrives.
          continue;
        }
      }
    }catch(e){if(op.alive)resultMessage(errorMessage(e));}
    finally{op.lock.release();if(operation.current===op)operation.current=null;if(mounted.current){setRunning(false);setConnection('');}void jobs.refetch();}
  };
  const cancel=()=>{const op=operation.current;if(!op)return;op.cancel=true;setCancelling(true);setProgress(describeMessage('task.cancelling'));if(op.id)void alignmentApi.cancel(op.id).catch(e=>{setCancelling(false);setConnection(describeMessage('task.cancelFailed',{diagnostic:e.message}));});};
  const button=<span className={styles.entry}><button data-role="primary" disabled={!!reason||opening||running||control.locked} title={reason??undefined} onClick={()=>void open()}>{running?t('task.aligning'):t('settings.alignment')}</button>{reason&&!running&&<small>{reason}</small>}{!running&&recent.current&&<button data-role="inline" onClick={()=>{const notice=recent.current!;setMessage(notice.text,notice.role,notice.timeout,notice.taskId);}}>{t('alignment.recent')}</button>}</span>;
  return <>
    {visible&&(ui.alignmentHost?createPortal(button,ui.alignmentHost):button)}
    {ui.taskHost && running && createPortal(<MessageBar notice={{ text: t('task.alignmentProgress',{progress,device:deviceText?' · '+deviceText:''}), role: 'status', origin: null, dismissible: false }} actions={<button data-role="secondary" disabled={cancelling} onClick={cancel}>{t('task.cancel')}</button>}/>, ui.taskHost)}
    {ui.messageHost && createPortal(<>
      <MessageBar notice={message} actions={message?.taskId && cpuFailure?.id === message.taskId ? <button data-role="secondary" disabled={running||control.locked||!!active} onClick={()=>void start(true)}>{t('task.retryCpu')}</button> : message?.taskId && message.role==='alert' ? <IconButton icon="refresh" label={t('alignment.retry')} data-role="secondary" disabled={running||control.locked||!!reason} onClick={()=>void open()}/> : undefined}/>
      <MessageBar notice={connection}/>
    </>, ui.messageHost)}
    {dialog&&<SettingsDialog title={t('settings.alignment')} close={()=>setDialog(false)} actions={<><button data-role="secondary" data-initial-focus onClick={()=>setDialog(false)}>{t('common.cancel')}</button><button data-role="primary" disabled={!summary?.emitting_count} onClick={()=>void start()}>{t('alignment.start')}</button></>}>
      <p>{t('alignment.help')}</p>
      <p>{t('alignment.scope',{included:summary?.line_count,skipped:summary?.skipped_count})}</p>
      {!!summary?.unknown_count&&<p>{t('alignment.unknownReadings',{count:summary.unknown_count})}</p>}
      <label><input type="checkbox" checked={options.use_hints} disabled={!summary?.hint_count} onChange={e=>setOptions({...options,use_hints:e.target.checked})}/>{t('alignment.useStarts')}</label>
      <p className={styles.description}>{summary?.hint_count?t('alignment.startsHelp'):t('alignment.noStarts')}</p>
      <label><input type="checkbox" checked={options.clear_unmatched} onChange={e=>setOptions({...options,clear_unmatched:e.target.checked})}/>{t('alignment.clearUnmatched')}</label>
      <p className={styles.description}>{t('alignment.clearHelp')}</p>
      <div className={styles.gapOption}>
        <input id={gapId} type="checkbox" checked={options.merge_short_gaps} onChange={e=>{setOptions({...options,merge_short_gaps:e.target.checked});setGapError('');}}/>
        <label htmlFor={gapId}>{t('alignment.mergeGapsLabel')}</label>
        <span className={styles.threshold}><input type="number" min="1" step="1" aria-label={t('alignment.gapThreshold')} aria-invalid={!!gapError} aria-describedby={gapError?gapErrorId:undefined} disabled={!options.merge_short_gaps} value={gapDraft} onChange={e=>{setGapDraft(e.target.value);setGapError('');}}/><label htmlFor={gapId}>ms</label></span>

      </div>
      {gapError&&<p id={gapErrorId} role="alert">{gapError}</p>}
      <fieldset className={styles.options}><legend>{t('alignment.experimental')}</legend>
        {([
          ['line_blank',t('alignment.blankCost'),t('alignment.blankHelp')],
          ['rest_blank',t('alignment.restBlankCost'),t('alignment.restBlankHelp')],
          ['rest_token',t('alignment.restTokenCost'),t('alignment.restTokenHelp')],
        ] as const).map(([key,label,description])=><label key={key}><input type="checkbox" checked={options[key]} onChange={e=>setOptions({...options,[key]:e.target.checked})}/><span>{label}<small className={styles.description}>{description}</small></span></label>)}
      </fieldset>
      {!summary?.emitting_count&&<p>{t('alignment.noReadings')}</p>}
    </SettingsDialog>}
  </>;
}

const t=i18n.t.bind(i18n);
