import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {alignmentCall,type AlignmentCatalog} from '../adapters/http/alignment';
import {usePreference} from '../adapters/studio-preferences';
import {SettingsPanel} from './editor/SettingsDialog';
import {SettingField} from '../shared/SettingsFields';
import {IconButton} from '../shared/Controls';
import {Icon} from '../shared/Icon';
import fields from '../shared/settings-fields.module.css';
import styles from './alignment.module.css';

export function VocalModels(){
  const {t}=useTranslation();
  const [selected,select]=usePreference('studio:vocal-model','demucs');
  const [catalog,setCatalog]=useState<AlignmentCatalog|null>(null);
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const run=async(path?:string|null)=>{
    setBusy(true);setError('');
    try{
      const value=await alignmentCall<AlignmentCatalog>(path===undefined?'/vocal-models?refresh=true':'/vocal-models/directory',path===undefined?undefined:{path});
      setCatalog(value);setDraft(value.directory);
    }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  };
  useEffect(()=>{void run();},[]);
  return <SettingsPanel embedded title={t('vocal.models')} close={()=>undefined} headerActions={<IconButton icon="refresh" data-role="secondary" label={t('alignment.refreshModels')} disabled={busy} onClick={()=>void run()}/>}>
    {catalog?.editable?<><SettingField stacked label={t('alignment.directory')}><input name="vocal-model-directory" autoComplete="off" spellCheck={false} value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy} title={draft}/></SettingField><div className={styles.directoryActions}><button data-role="primary" disabled={busy} onClick={()=>void run(draft)}>{t('alignment.applyDirectory')}</button><button data-role="secondary" disabled={busy} onClick={()=>void run(null)}>{t('alignment.defaultDirectory')}</button></div></>:<div className={styles.directoryRow}><small className={styles.description}>{t('alignment.directoryServer')}</small></div>}
    {error&&<p role="alert">{error}</p>}
    <div className={fields.cards} role="radiogroup" aria-label={t('vocal.models')} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index=buttons.indexOf(event.target as HTMLButtonElement);
      if(index<0||!buttons.length)return;
      event.preventDefault();const next=buttons[(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length];next.focus();next.click();
    }}>{catalog?.items.map(item=><button key={item.id} type="button" className={`${fields.card} ${styles.vocalChoice}`} data-role="secondary" role="radio" tabIndex={selected===item.id||!catalog.items.some(row=>row.id===selected&&row.status==='ready')&&item===catalog.items.find(row=>row.status==='ready')?0:-1} aria-checked={selected===item.id} disabled={busy||item.status!=='ready'} onClick={()=>select(item.id!)}>
      <strong>{item.name} {selected===item.id&&<Icon name="check"/>}</strong><small>{t(item.type==='bs-karaoke'?'vocal.lead':'vocal.vocals')} · {item.status==='ready'?t('alignment.structureReady'):item.reason}</small>
    </button>)}</div>
  </SettingsPanel>;
}
