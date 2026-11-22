import { useMessageText } from '../../shared/useMessageText';
import { errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { importDictionary, listDictionaries, removeDictionary, type DictionaryInfo, type DictionaryInstall } from '../../adapters/http/dictionaries';
import { IconButton } from '../../shared/Controls';
import { SettingsPanel } from './SettingsDialog';
import fields from '../../shared/settings-fields.module.css';
import styles from './dictionary-ruby.module.css';

export function dictionaryLabel(item:DictionaryInfo) {
  const m=item.manifest;
  return m?`${String(m.name)} · ${String(m.version)} · ${String(m.region)}`:item.id;
}
export function DictionaryManager({close, embedded}:{close:()=>void; embedded?:boolean}) {
  useTranslation();
  const fileInput=useRef<HTMLInputElement>(null);
  const [items,setItems]=useState<DictionaryInfo[]>([]),[error,setError]=useMessageText(''),[busy,setBusy]=useState(false),[installed,setInstalled]=useState<number|null>(null);
  const [pending,setPending]=useState<{file:File;info:DictionaryInstall}|null>(null),[removing,setRemoving]=useState<DictionaryInfo|null>(null);
  const refresh=async()=>{const result=await listDictionaries();setItems(result.dictionaries);setError(result.errors.join(t('notice.separator')));};
  useEffect(()=>{const abort=new AbortController();void listDictionaries(abort.signal).then(r=>{setItems(r.dictionaries);setError(r.errors.join(t('notice.separator')));}).catch(e=>{if(!abort.signal.aborted)setError(errorMessage(e));});return()=>abort.abort();},[]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
  return <SettingsPanel embedded={embedded} returnFocus={()=>document.querySelector<HTMLElement>('[data-settings-button]')} title={t('dictionary.title')} headerActions={<IconButton icon="folder" label={t('dictionary.import')} data-role="secondary" disabled={busy} onClick={()=>fileInput.current?.click()}/>} close={()=>{if(!busy)close();}}>
    <div className={styles.manager}>
      <input ref={fileInput} aria-label={t('dictionary.import')} hidden type="file" accept=".zip" disabled={busy} onChange={e=>{
        const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{setPending({file,info:await importDictionary(file,true)});});
      }}/>
      {busy&&<p role="status">{t('dictionary.busy')}</p>}
      {installed!==null&&<p role="status">{t('dictionary.installedCount',{count:installed})}</p>}
      {error&&<p role="alert">{error}</p>}
      {pending&&<section className={fields.card}>
        <strong>{String(pending.info.manifest.name)}</strong>
        <p>{String(pending.info.manifest.version)} · {String(pending.info.manifest.region)} · {String(pending.info.manifest.notation)}</p>
        {pending.info.replaceRequired&&<p>{t('dictionary.replacing')}</p>}
        <div className={styles.actions}><button data-role="secondary" disabled={busy} onClick={()=>setPending(null)}>{t('common.cancel')}</button>
          <button data-role={pending.info.replaceRequired?'danger':'primary'} disabled={busy} onClick={()=>void run(async()=>{const result=await importDictionary(pending.file,false,!!pending.info.replaceRequired);setInstalled(result.entryCount);setPending(null);await refresh();})}>{pending.info.replaceRequired?t('dictionary.replace'):t('dictionary.install')}</button></div>
      </section>}
      {!items.length&&!busy&&<p>{t('dictionary.empty')}</p>}
      <div className={fields.cards}>{items.map(item=><section className={fields.card} key={item.instance}>
        <div className={fields.cardHeader}><span><strong>{item.manifest?String(item.manifest.name):item.id}</strong>{item.manifest&&<small> · {String(item.manifest.version)} · {String(item.manifest.region)}</small>}</span>
        <IconButton icon="trash" label={t('dictionary.remove',{name:dictionaryLabel(item)})} data-role="danger" disabled={busy} onClick={()=>setRemoving(item)}/></div>
        {item.error&&<p role="alert">{item.error}</p>}
        {removing?.id===item.id&&<div><p>{t('dictionary.removeHelp')}</p><div className={styles.actions}>
          <button data-role="secondary" disabled={busy} onClick={()=>setRemoving(null)}>{t('common.cancel')}</button>
          <button data-role="danger" disabled={busy} onClick={()=>void run(async()=>{await removeDictionary(item.id);setRemoving(null);await refresh();})}>{t('dictionary.confirmRemove')}</button>
        </div></div>}
      </section>)}</div>
    </div>
  </SettingsPanel>;
}

const t=i18n.t.bind(i18n);
