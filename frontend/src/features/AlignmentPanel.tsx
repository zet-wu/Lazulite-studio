import { MessageBar, useNotice } from '../shared/MessageBar';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { alignmentApi, defaultAlignmentOptions, type AlignmentSummary } from '../adapters/http/alignment';
import { jobsApi } from '../adapters/http/jobs';
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
  pid:string; assetId?:string; durationMs:number; project:ProjectDocument; control:AlignmentControl; visible:boolean; finishDraft:()=>boolean;
}) {
  const ui=useAudioReview();
  const caps=useQuery({queryKey:['capabilities'],queryFn:()=>jobsApi.capabilities()});
  const jobs=useQuery({queryKey:['vocal-jobs',pid],queryFn:()=>jobsApi.list(pid),refetchInterval:1000});
  const [dialog,setDialog]=useState(false),[options,setOptions]=useState(defaultAlignmentOptions),[summary,setSummary]=useState<AlignmentSummary|null>(null);
  const [gapDraft,setGapDraft]=useState('500'),[gapError,setGapError]=useState('');
  const gapId=useId(),gapErrorId=useId();
  const [message,setMessage]=useNotice();
  const [cpuFailure,setCpuFailure] = useState<{id:string; source:string; revision:string; options:ReturnType<typeof defaultAlignmentOptions>}|null>(null);
  const [deviceText,setDeviceText] = useState('');
  const [progress,setProgress]=useState('');
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
  const reason=!assetId?'请先上传源音频':!project.lyrics.lines.some(l=>!project.editing.skippedAlignmentLineIds.includes(l.id))?'没有未跳过的歌词行':!capability?.enabled?(capability?.reason??'正在检查模型能力'):active?'已有音频处理运行':null;
  const open=async()=>{
    if(!finishDraft())return;
    setOpening(true);setMessage('');setOptions(defaultAlignmentOptions());setGapDraft('500');setGapError('');
    try {const saved=await control.save();if(!saved)throw new Error('请先完成保存');const data=await alignmentApi.preview(pid,saved.revision);if(mounted.current){setSummary(data);setDialog(true);}}
    catch(e){setMessage((e as Error).message);}finally{if(mounted.current)setOpening(false);}
  };
  const start=async(retryCpu = false)=>{
    const threshold=options.merge_short_gaps?Number(gapDraft):500;
    if(options.merge_short_gaps && (!gapDraft.trim() || !Number.isSafeInteger(threshold) || threshold<=0)){setGapError('行内空隙阈值必须为正的安全整数毫秒');return;}
    const failed = retryCpu ? cpuFailure : null;
    if (retryCpu && (!failed || failed.source !== JSON.stringify(project))) { setMessage('歌词、声学内容或应用意图已改变，请重新发起对齐'); return; }
    const selected = failed?.options ?? {...options,gap_threshold_ms:threshold};
    setDialog(false);setRunning(true);setCancelling(false);setMessage('');setProgress('正在准备');
    let lock:ReturnType<AlignmentControl['lock']>;
    try{lock=control.lock();}catch(e){setMessage((e as Error).message);setRunning(false);return;}
    const op={alive:true,cancel:false,id:undefined as string|undefined,lock};operation.current=op;
    try {
      const saved=await control.save();if(!saved)throw new Error('无法确认保存版本');
      if(!op.alive||op.cancel){if(op.alive)setMessage('已取消对齐','status',4000);return;}
      if (failed && saved.revision !== failed.revision) throw new Error('项目版本已改变，请重新发起对齐');
      setCpuFailure(null);
      const key=crypto.randomUUID();
      // A lost launch response is retried with the same key, never a second model execution.
      let job;
      try {job=failed ? await jobsApi.retryCpu(failed.id,saved.revision,key) : await alignmentApi.start(pid,saved.revision,selected,key);}
      catch(e){if(e instanceof TypeError)job=failed ? await jobsApi.retryCpu(failed.id,saved.revision,key) : await alignmentApi.start(pid,saved.revision,selected,key);else throw e;}
      op.id=job.id;
      if(!op.alive||op.cancel){await alignmentApi.cancel(job.id);if(op.alive)setMessage('已取消对齐','status',4000);return;}
      let disconnectedAt = 0;
      while(op.alive){
        if(job.request?.devices)setDeviceText(Object.entries(job.request.devices).map(([stage,d])=>`${stage==='vocal'?'人声分离':'自动对齐'}：${d.label}${d.reason ? `（${d.reason}）` : ''}`).join('；'));
        if(job.status==='failed'&&job.error?.cpu_retry)setCpuFailure({id:job.id,source:JSON.stringify(op.lock.source),revision:saved.revision,options:selected});
        if(job.status==='succeeded'){
          if(op.cancel){setMessage('已取消应用','status',4000);break;}
          const result=await alignmentApi.result(job.id);
          const current=await studioS4.getDocumentEnvelope(pid);
          if(!op.alive||op.cancel){if(op.alive)setMessage('已取消应用','status',4000);break;}
          if(current.revision!==saved.revision || result.binding.revision!==saved.revision || result.binding.project_id!==pid || result.binding.asset_id!==assetId)throw new Error('项目版本或音频已改变，请重新运行');
          const merged=mergeAlignment(op.lock.source,result,durationMs,selected.clear_unmatched,selected.merge_short_gaps?selected.gap_threshold_ms:null);op.lock.apply(merged.project);
          setMessage([merged.project===op.lock.source?'未更新歌词时间':'已更新歌词时间', merged.mergedGaps?`合并 ${merged.mergedGaps} 处行内空隙`:'', merged.cleared.length?`清空 ${merged.cleared.length} 个词／注音的缺失端点`:'', merged.retained.length?`${merged.retained.length} 个词／注音部分时间保留原值`:''].filter(Boolean).join('；'), 'status', merged.retained.length||merged.cleared.length?8000:4000);break;
        }
        if(['failed','cancelled','interrupted'].includes(job.status)){setMessage(job.error?.message??(job.status==='cancelled'?'已取消对齐':'服务中断，请重新运行'), job.status==='cancelled'?'status':'alert', job.status==='cancelled'?4000:undefined);break;}
        if(!disconnectedAt)setProgress(op.cancel?'正在取消':({separating:'正在分离人声',analyzing:'正在分析声区',acoustic:'正在计算声学概率',decode:'正在全局对齐'}[job.stage??'']??'正在对齐'));
        await new Promise(resolve=>setTimeout(resolve,700));
        if(!op.alive)break;
        try{job=await alignmentApi.state(job.id);disconnectedAt=0;}catch(e){if(e instanceof TypeError){if(!disconnectedAt)setMessage('连接中断，正在重新确认运行状态');disconnectedAt ||= Date.now();if(Date.now()-disconnectedAt>30000){op.cancel=true;void alignmentApi.cancel(job.id).catch(()=>undefined);throw new Error('服务连接中断，本次结果不再应用；恢复连接后确认状态');}continue;}throw e;}
      }
    }catch(e){if(op.alive)setMessage((e as Error).message);}
    finally{op.lock.release();if(operation.current===op)operation.current=null;if(mounted.current)setRunning(false);void jobs.refetch();}
  };
  const cancel=()=>{const op=operation.current;if(!op)return;op.cancel=true;setCancelling(true);setProgress('正在取消');if(op.id)void alignmentApi.cancel(op.id).catch(e=>setMessage(`正在取消；${e.message}`));};
  const button=<span className={styles.entry}><button data-role="primary" disabled={!!reason||opening||running||control.locked} title={reason??undefined} onClick={()=>void open()}>{running?'正在对齐':'自动对齐'}</button>{reason&&!running&&<small>{reason}</small>}</span>;
  return <>
    {visible&&(ui.alignmentHost?createPortal(button,ui.alignmentHost):button)}
    <MessageBar notice={message}/>
    {visible && deviceText && <p>{deviceText}</p>}
    {visible && cpuFailure && <button data-role="secondary" disabled={running||control.locked||!!active} onClick={()=>void start(true)}>使用 CPU 重试</button>}
    {running&&<div className={styles.status}><span role="status">{cancelling?'正在取消':progress}</span><button data-role="secondary" disabled={cancelling} onClick={cancel}>{cancelling?'正在取消':'取消'}</button></div>}
    {dialog&&<SettingsDialog title="自动对齐" close={()=>setDialog(false)} actions={<><button data-role="secondary" data-initial-focus onClick={()=>setDialog(false)}>取消</button><button data-role="primary" disabled={!summary?.emitting_count} onClick={()=>void start()}>开始对齐</button></>}>
      <p>请确认假名注音完整且与实际唱法一致。自动对齐使用正文和假名注音，处理期间无法编辑，完成后一次应用未跳过行的时间，可一次撤销。</p>
      <p>将对齐 {summary?.line_count} 行，跳过 {summary?.skipped_count} 行</p>
      {!!summary?.unknown_count&&<p>有 {summary.unknown_count} 处缺少可用读音，相关时间可能保留原值</p>}
      <label><input type="checkbox" checked={options.use_hints} disabled={!summary?.hint_count} onChange={e=>setOptions({...options,use_hints:e.target.checked})}/>使用已有行起始时间辅助对齐</label>
      <p className={styles.description}>{summary?.hint_count?'适合已有大致准确行首的歌词':'参与行没有已有行首'}</p>
      <label><input type="checkbox" checked={options.clear_unmatched} onChange={e=>setOptions({...options,clear_unmatched:e.target.checked})}/>清空未匹配单元时间</label>
      <p className={styles.description}>清空本次对齐范围内没有新时间建议的词／注音端点，包括未送入对齐的符号、标点和空白；可一次撤销。</p>
      <div className={styles.gapOption}>
        <input id={gapId} type="checkbox" checked={options.merge_short_gaps} onChange={e=>{setOptions({...options,merge_short_gaps:e.target.checked});setGapError('');}}/>
        <label htmlFor={gapId}>将短于</label>
        <span className={styles.threshold}><input type="number" min="1" step="1" aria-label="行内空隙阈值（毫秒）" aria-invalid={!!gapError} aria-describedby={gapError?gapErrorId:undefined} disabled={!options.merge_short_gaps} value={gapDraft} onChange={e=>{setGapDraft(e.target.value);setGapError('');}}/><label htmlFor={gapId}>ms</label></span>
        <label htmlFor={gapId}>的行内空隙并入前词</label>
      </div>
      {gapError&&<p id={gapErrorId} role="alert">{gapError}</p>}
      <fieldset className={styles.options}><legend>实验性对齐选项</legend>
        {([
          ['line_blank','行内 blank 代价','抑制同一行内部过长的 blank 停留'],
          ['rest_blank','人声休止 blank 代价','在低人声活动处增加行内 blank 代价'],
          ['rest_token','人声休止 token 代价','抑制发音目标落入低人声活动区'],
        ] as const).map(([key,label,description])=><label key={key}><input type="checkbox" checked={options[key]} onChange={e=>setOptions({...options,[key]:e.target.checked})}/><span>{label}<small className={styles.description}>{description}</small></span></label>)}
      </fieldset>
      {!summary?.emitting_count&&<p>没有可用读音，无法计算</p>}
    </SettingsDialog>}
  </>;
}
