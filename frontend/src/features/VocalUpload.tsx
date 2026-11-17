import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {studioApi as api, uploadMusic, vocalApi} from '../adapters/http/client';
import type {Asset} from '../adapters/http/client';
import {SettingsDialog} from './editor/SettingsDialog';
import {SettingField} from '../shared/SettingsFields';
import {MessageBar, useNotice} from '../shared/MessageBar';
import {errorMessage, message} from '../domain/messages';
import fields from '../shared/settings-fields.module.css';

export function VocalUpload({projectId, sourceAssetId, durationMs, available, disabled, submit}: {
  projectId:string; sourceAssetId:string; durationMs:number|null; available:boolean; disabled:boolean;
  submit:(uploadId:string, offsetMs:number)=>Promise<boolean>;
}) {
  const {t}=useTranslation();
  const trigger=useRef<HTMLButtonElement>(null);
  const input=useRef<HTMLInputElement>(null), request=useRef<AbortController|null>(null);
  const staged=useRef<Asset|null>(null), version=useRef(0), editVersion=useRef(0);
  const [upload,setUpload]=useState<Asset|null>(null), [offset,setOffset]=useState('0');
  const [reading,setReading]=useState(false), [calculating,setCalculating]=useState(false), [applying,setApplying]=useState(false);
  const [notice,publish]=useNotice();
  const close=()=>{++version.current;request.current?.abort();request.current=null;setCalculating(false);setReading(false);setUpload(null);if(staged.current){void api.discardUpload(staged.current.id).catch(e=>publish(errorMessage(e)));staged.current=null;}};
  useEffect(()=>()=>{++version.current;request.current?.abort();if(staged.current)void api.discardUpload(staged.current.id).catch(()=>undefined);},[sourceAssetId]);
  const select=async(file:File)=>{
    close();const serial=version.current;const controller=new AbortController();request.current=controller;setReading(true);publish(null);
    try {const asset=await uploadMusic(file,()=>{},controller.signal);if(serial!==version.current){await api.discardUpload(asset.id);return;}staged.current=asset;setUpload(asset);setOffset('0');++editVersion.current;}
    catch(e){if(!controller.signal.aborted)publish(errorMessage(e));}
    finally{if(serial===version.current)setReading(false);}
  };
  const calculate=async()=>{
    if(!upload)return;const serial=version.current, edit=editVersion.current;
    const controller=new AbortController();request.current=controller;setCalculating(true);publish(null);
    try{const result=await vocalApi.offset(projectId,sourceAssetId,upload.id,controller.signal);if(serial!==version.current||edit!==editVersion.current)return;
      if(result.offset_ms===null)publish(message('vocal.offsetUncertain'));else setOffset(String(result.offset_ms));
    }catch(e){if(!controller.signal.aborted)publish(errorMessage(e));}
    finally{if(serial===version.current)setCalculating(false);}
  };
  const valid=offset.trim()!==''&&Number.isFinite(Number(offset));
  return <><button ref={trigger} data-role="secondary" disabled={disabled||reading||applying||!sourceAssetId} onClick={()=>input.current?.click()}>{t(reading?'common.reading':available?'vocal.replaceUpload':'vocal.upload')}</button>
    <input hidden type="file" accept="audio/*,video/*" ref={input} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void select(file);}}/>
    {upload&&<SettingsDialog title={t('vocal.offsetTitle')} returnFocus={()=>trigger.current} close={()=>{if(!applying)close();}} actions={<div className={fields.actions}><button data-role="secondary" disabled={applying} onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={!valid||disabled||applying} onClick={async()=>{setApplying(true);try{if(await submit(upload.id,Number(offset)))close();}catch(e){publish(errorMessage(e));}finally{setApplying(false);}}}>{t('common.apply')}</button></div>}>
      <p>{t('vocal.durations',{source:((durationMs??0)/1000).toFixed(3),uploaded:((upload.duration_ms??0)/1000).toFixed(3)})}</p>
      <SettingField label={t('vocal.offsetMs')} description={t('vocal.offsetHelp')}><input data-initial-focus name="vocal-offset" autoComplete="off" type="number" step="any" value={offset} disabled={applying} onChange={e=>{++editVersion.current;setOffset(e.target.value);}}/></SettingField>
      <div className={fields.actions}><button data-role="secondary" disabled={calculating||applying} onClick={()=>void calculate()}>{t(calculating?'vocal.calculatingOffset':'vocal.calculateOffset')}</button></div>
      <MessageBar notice={notice}/>
    </SettingsDialog>}
    {!upload&&<MessageBar notice={notice}/>}</>;
}
