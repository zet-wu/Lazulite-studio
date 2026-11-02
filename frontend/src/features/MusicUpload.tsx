import { useMessageText } from '../shared/useMessageText';
import { message, messageList, errorMessage } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { ApiError, studioApi, uploadMusic, type Asset } from '../adapters/http/client';
import styles from './workspace.module.css';

type Binding = Awaited<ReturnType<typeof studioApi.attachMusic>>;
type Props = { disabled?: boolean; onBusyChange?: (busy: boolean) => void; projectId:string; assetId:string|null; openRequest:number;
  prepare:()=>Promise<{revision:string;release:()=>void}>;
  accepted:(result:Binding)=>Promise<void>; stop:()=>void };
export function MusicUpload({projectId,assetId,openRequest,prepare,accepted,stop,disabled,onBusyChange}: Props) {
  useTranslation();
  const handlers=useRef({prepare,accepted,stop});handlers.current={prepare,accepted,stop};
  const input=useRef<HTMLInputElement>(null), controller=useRef<AbortController|null>(null);
  const pending=useRef<{request:Parameters<typeof studioApi.attachMusic>[1];release:()=>void}|null>(null);
  const [progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useMessageText('');
  const [uncertain,setUncertain]=useState(false),[cleanup,setCleanup]=useState(false);
  const unavailable=busy||uncertain||cleanup||!!disabled;
  useEffect(()=>{onBusyChange?.(busy||uncertain||cleanup);},[busy,uncertain,cleanup,onBusyChange]);
  const last=useRef(0);
  useEffect(()=>{if(openRequest!==last.current){last.current=openRequest;if(!unavailable&&!pending.current)input.current?.click();}},[openRequest,unavailable]);
  useEffect(()=>()=>{controller.current?.abort();pending.current?.release();},[]);
  const confirm=async()=>{
    const operation=pending.current;if(!operation)return;
    setBusy(true);setError('');
    try {
      const result=await studioApi.attachMusic(projectId,operation.request);
      await handlers.current.accepted(result);
      setCleanup(result.cleanup_pending);
      if(result.cleanup_pending)setError(message('music.cleanupFailed'));
      else pending.current=null;
      setUncertain(false);operation.release();
    } catch(cause) {
      const rejected=cause instanceof ApiError && [404,409,412,422].includes(cause.status);
      if(rejected){
        operation.release();pending.current=null;setUncertain(false);
        try{await studioApi.discardUpload(operation.request.upload_id);}
        catch(cleanupCause){setError(messageList([errorMessage(cause),errorMessage(cleanupCause)]));return;}
      }
      else setUncertain(true);
      setError(errorMessage(cause));
    } finally {setBusy(false);}
  };
  const upload=async(file:File)=>{
    if(unavailable||controller.current||pending.current)return;
    const active=new AbortController();controller.current=active;setBusy(true);setError('');setProgress(0);
    let staged:Asset|undefined;
    try {
      staged=await uploadMusic(file,setProgress,active.signal);
      if(active.signal.aborted){await studioApi.discardUpload(staged.id);return;}
      const lock=await handlers.current.prepare();handlers.current.stop();
      pending.current={request:{upload_id:staged.id,revision:lock.revision,expected_asset_id:assetId,operation_id:crypto.randomUUID()},release:lock.release};
      await confirm();
    } catch(cause) {
      setError((cause as Error).name==='AbortError'?message('music.cancelled'):errorMessage(cause));
      if(staged&&!pending.current)await studioApi.discardUpload(staged.id);
    } finally {setBusy(false);controller.current=null;}
  };
  return <footer className={styles.musicUpload} aria-label={t('music.project')}>
    {!assetId&&<><span>{t('music.empty')}</span><button data-role="secondary" disabled={unavailable} onClick={()=>input.current?.click()}>{t('menu.importAudio')}</button></>}
    <input hidden ref={input} aria-label={t('music.file')} type="file" accept="audio/*,video/mp4,.m4a" disabled={unavailable} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/>
    {busy&&<><progress aria-label={t('music.progress')} value={progress} max={1}/><span>{pending.current?t('music.switching'):t('music.uploading')}</span><button data-role="secondary" disabled={!!pending.current} onClick={()=>controller.current?.abort()}>{t('common.cancel')}</button></>}
    {error&&<span role="alert">{error}</span>}
    {(uncertain||cleanup)&&<button data-role="secondary" disabled={busy} onClick={()=>void confirm()}>{cleanup?t('music.cleanupRetry'):t('music.confirm')}</button>}
  </footer>;
}

const t=i18n.t.bind(i18n);
