import { useEffect, useRef, useState } from 'react';
import { ApiError, studioApi, uploadMusic, type Asset } from '../adapters/http/client';
import styles from './workspace.module.css';

type Binding = Awaited<ReturnType<typeof studioApi.attachMusic>>;
type Props = { projectId:string; assetId:string|null; openRequest:number;
  prepare:()=>Promise<{revision:string;release:()=>void}>;
  accepted:(result:Binding)=>Promise<void>; stop:()=>void };
export function MusicUpload({projectId,assetId,openRequest,prepare,accepted,stop}: Props) {
  const input=useRef<HTMLInputElement>(null), controller=useRef<AbortController|null>(null);
  const pending=useRef<{request:Parameters<typeof studioApi.attachMusic>[1];release:()=>void}|null>(null);
  const [progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [uncertain,setUncertain]=useState(false),[cleanup,setCleanup]=useState(false);
  const last=useRef(0);
  useEffect(()=>{if(openRequest!==last.current){last.current=openRequest;if(!busy&&!pending.current)input.current?.click();}},[openRequest,busy]);
  useEffect(()=>()=>{controller.current?.abort();pending.current?.release();},[]);
  const confirm=async()=>{
    const operation=pending.current;if(!operation)return;
    setBusy(true);setError('');
    try {
      const result=await studioApi.attachMusic(projectId,operation.request);
      await accepted(result);
      setCleanup(result.cleanup_pending);
      if(result.cleanup_pending)setError('新音频已接入，旧文件尚未释放；停止播放或下载后重试清理');
      else pending.current=null;
      setUncertain(false);operation.release();
    } catch(cause) {
      const rejected=cause instanceof ApiError && [404,409,412,422].includes(cause.status);
      if(rejected){operation.release();pending.current=null;setUncertain(false);}
      else setUncertain(true);
      setError((cause as Error).message);
    } finally {setBusy(false);}
  };
  const upload=async(file:File)=>{
    const active=new AbortController();controller.current=active;setBusy(true);setError('');setProgress(0);
    let staged:Asset|undefined;
    try {
      staged=await uploadMusic(file,setProgress,active.signal);
      if(active.signal.aborted){await studioApi.discardUpload(staged.id);return;}
      const lock=await prepare();stop();
      pending.current={request:{upload_id:staged.id,revision:lock.revision,expected_asset_id:assetId,operation_id:crypto.randomUUID()},release:lock.release};
      await confirm();
    } catch(cause) {
      setError((cause as Error).name==='AbortError'?'上传已取消':(cause as Error).message);
      if(staged&&!pending.current)await studioApi.discardUpload(staged.id);
    } finally {setBusy(false);controller.current=null;}
  };
  return <footer className={styles.musicUpload} aria-label="项目音乐">
    {!assetId&&<><span>未上传音乐；歌词可编辑、保存及下载。</span><button data-role="secondary" disabled={busy||uncertain} onClick={()=>input.current?.click()}>导入音频</button></>}
    <input hidden ref={input} aria-label="导入音频文件" type="file" accept="audio/*,video/mp4,.m4a" disabled={busy||uncertain} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/>
    {busy&&<><progress aria-label="音乐上传进度" value={progress} max={1}/><span>{pending.current?'正在切换音频…':'正在上传和探测音频…'}</span><button data-role="secondary" disabled={!!pending.current} onClick={()=>controller.current?.abort()}>取消</button></>}
    {error&&<span role="alert">{error}</span>}
    {(uncertain||cleanup)&&<button data-role="secondary" disabled={busy} onClick={()=>void confirm()}>{cleanup?'重试清理':'确认导入结果'}</button>}
  </footer>;
}
