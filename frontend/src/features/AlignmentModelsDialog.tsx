import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { alignmentApi, type AlignmentCatalog } from '../adapters/http/alignment';
import { SettingsDialog } from './editor/SettingsDialog';
import { IconButton } from '../shared/Controls';

export function AlignmentModelsDialog({catalog, update, close}: {catalog:AlignmentCatalog|null; update:(value:AlignmentCatalog)=>void; close:()=>void}) {
  const {t}=useTranslation();
  const [draft,setDraft]=useState(catalog?.directory??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const run=async(path?:string|null)=>{
    setBusy(true);setError('');
    try {const value=path===undefined?await alignmentApi.models(true):await alignmentApi.directory(path);update(value);if(path!==undefined)setDraft(value.directory);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <SettingsDialog title={t('alignment.models')} close={close} actions={<button data-role="secondary" onClick={close}>{t('common.close')}</button>}>
    <p>{t(catalog?.editable?'alignment.directoryPortable':'alignment.directoryServer')}</p>
    <p>{catalog?.directory}</p>
    {catalog?.editable&&<><label>{t('alignment.directory')}<input value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/></label><button data-role="primary" disabled={busy} onClick={()=>void run(draft)}>{t('alignment.applyDirectory')}</button><button data-role="secondary" disabled={busy} onClick={()=>void run(null)}>{t('alignment.defaultDirectory')}</button></>}
    <IconButton icon="refresh" label={t('alignment.refreshModels')} data-role="secondary" disabled={busy} onClick={()=>void run()}/>
    {(error||catalog?.error)&&<p role="alert">{error||catalog?.error}</p>}
    {!catalog?.items.length&&<p>{t('alignment.noModels')}</p>}
    <ul>{catalog?.items.map(item=><li key={item.name}><strong>{item.name}</strong> · {item.type} · {item.status==='ready'?t('alignment.structureReady'):item.reason}</li>)}</ul>
    <p>{t('alignment.modelQuality')}</p>
  </SettingsDialog>;
}
