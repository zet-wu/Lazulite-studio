import { useEffect, useState } from 'react';
import { importDictionary, listDictionaries, removeDictionary, type DictionaryInfo, type DictionaryInstall } from '../../adapters/http/dictionaries';
import { IconButton } from '../../shared/Controls';
import { SettingsDialog } from './SettingsDialog';
import styles from './dictionary-ruby.module.css';

export function dictionaryLabel(item:DictionaryInfo) {
  const m=item.manifest;
  return m?`${String(m.name)} · ${String(m.version)} · ${String(m.region)}`:item.id;
}
export function DictionaryManager({close}:{close:()=>void}) {
  const [items,setItems]=useState<DictionaryInfo[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{file:File;info:DictionaryInstall}|null>(null),[removing,setRemoving]=useState<DictionaryInfo|null>(null);
  const refresh=async()=>{const result=await listDictionaries();setItems(result.dictionaries);setError(result.errors.join('；'));};
  useEffect(()=>{const abort=new AbortController();void listDictionaries(abort.signal).then(r=>{setItems(r.dictionaries);setError(r.errors.join('；'));}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <SettingsDialog title="注音词典" close={()=>{if(!busy)close();}}>
    <div className={styles.manager}>
      <label>导入词典 ZIP<input type="file" accept=".zip" disabled={busy} onChange={e=>{
        const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{setPending({file,info:await importDictionary(file,true)});});
      }}/></label>
      {busy&&<p role="status">正在校验或更新词典…</p>}
      {error&&<p role="alert">{error}</p>}
      {pending&&<section className={styles.card}>
        <strong>{String(pending.info.manifest.name)}</strong>
        <p>{String(pending.info.manifest.version)} · {String(pending.info.manifest.region)} · {String(pending.info.manifest.notation)}</p>
        <p>{pending.info.entryCount} 个词条{pending.info.replaceRequired?'；将替换相同 ID 的已安装词典':''}</p>
        <details><summary>来源与许可</summary><pre>{JSON.stringify(pending.info.sources,null,2)}</pre></details>
        <div className={styles.actions}><button data-role="secondary" disabled={busy} onClick={()=>setPending(null)}>取消</button>
          <button data-role={pending.info.replaceRequired?'danger':'primary'} disabled={busy} onClick={()=>void run(async()=>{await importDictionary(pending.file,false,!!pending.info.replaceRequired);setPending(null);await refresh();})}>{pending.info.replaceRequired?'替换词典':'安装词典'}</button></div>
      </section>}
      {!items.length&&!busy&&<p>尚未安装词典。导入一个词典包后即可生成注音。</p>}
      {items.map(item=><section className={styles.card} key={item.instance}>
        <strong>{dictionaryLabel(item)}</strong>
        {item.error&&<p role="alert">{item.error}</p>}
        <details><summary>来源与许可</summary><pre>{JSON.stringify(item.sources,null,2)}</pre></details>
        <IconButton icon="trash" label={`移除 ${dictionaryLabel(item)}`} data-role="danger" disabled={busy} onClick={()=>setRemoving(item)}/>
        {removing?.id===item.id&&<div><p>移除后，项目中已保存的注音仍会保留。</p><div className={styles.actions}>
          <button data-role="secondary" disabled={busy} onClick={()=>setRemoving(null)}>取消</button>
          <button data-role="danger" disabled={busy} onClick={()=>void run(async()=>{await removeDictionary(item.id);setRemoving(null);await refresh();})}>确认移除</button>
        </div></div>}
      </section>)}
    </div>
  </SettingsDialog>;
}
