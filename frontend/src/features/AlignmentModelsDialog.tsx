import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { alignmentApi, type AlignmentCatalog } from '../adapters/http/alignment';
import { SettingsDialog } from './editor/SettingsDialog';
import { IconButton } from '../shared/Controls';
import styles from './alignment.module.css';

export function AlignmentModelsDialog({close, returnFocus}: {close:()=>void; returnFocus:()=>HTMLElement|null}) {
  const {t}=useTranslation();
  const directoryId=useId();
  const [catalog,setCatalog]=useState<AlignmentCatalog|null>(null);
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    void alignmentApi.models().then(value=>{if(alive){setCatalog(value);setDraft(value.directory);}})
      .catch(e=>{if(alive)setError((e as Error).message);}).finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[]);
  const run=async(path?:string|null)=>{
    setBusy(true);setError('');
    try {const value=path===undefined?await alignmentApi.models(true):await alignmentApi.directory(path);setCatalog(value);if(path!==undefined||!catalog)setDraft(value.directory);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const refresh=<IconButton icon="refresh" label={t('alignment.refreshModels')} data-role="secondary" disabled={busy} onClick={()=>void run()}/>;
  return <SettingsDialog title={t('alignment.models')} close={close} returnFocus={returnFocus} actions={<button data-role="secondary" onClick={close}>{t('common.close')}</button>}>
    {catalog?.editable?<>
      <label htmlFor={directoryId}>{t('alignment.directory')}</label>
      <div className={styles.directoryRow}><input id={directoryId} value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/>{refresh}</div>
      <div className={styles.directoryActions}><button data-role="primary" disabled={busy} onClick={()=>void run(draft)}>{t('alignment.applyDirectory')}</button><button data-role="secondary" disabled={busy} onClick={()=>void run(null)}>{t('alignment.defaultDirectory')}</button></div>
    </>:<div className={styles.directoryRow}><small className={styles.description}>{catalog?t('alignment.directoryServer'):t('alignment.checkingModels')}</small>{refresh}</div>}
    {(error||catalog?.error)&&<p role="alert">{error||catalog?.error}</p>}
    {catalog&&!catalog.items.some(item=>item.status==='ready')&&<p>{t('alignment.noModels')}</p>}
    <ul className={styles.modelCards}>{catalog?.items.map(item=><li key={item.name}>
      <div><strong>{item.name}</strong>{item.type&&<> · {item.type}</>}</div>
      <small className={item.status==='ready'?styles.description:styles.modelError}>{item.status==='ready'?t('alignment.structureReady'):item.reason}</small>
    </li>)}</ul>
  </SettingsDialog>;
}
