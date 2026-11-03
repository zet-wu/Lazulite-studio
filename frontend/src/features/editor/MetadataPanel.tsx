import { readSourceMetadata } from '../../adapters/http/source-metadata';
import { DialogEditingLocked } from './SettingsDialog';
import { useMessageText } from '../../shared/useMessageText';
import { errorMessage, message } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/Icon';
import { useContext, useEffect, useRef, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { DraftInput } from './EditorFields';
import { TableField } from './ManagementTable';
import { IconButton } from '../../shared/Controls';

const preferred = ['title','artist','album','composer','arranger','lyricist','year','isrc'];
type Props = { document: LyricDocument; apply: (command: LyricCommand) => boolean };
export function MetadataPanel({ document, apply, projectId, sourceAssetId }: Props & { projectId?: string; sourceAssetId?: string }) {
  useTranslation();
 const locked = useContext(DialogEditingLocked);
 const root = useRef<HTMLDivElement>(null), request = useRef<AbortController | null>(null);
 const latest = useRef({ document, apply, projectId, sourceAssetId, locked });
 latest.current = { document, apply, projectId, sourceAssetId, locked };
 const [reading, setReading] = useState(false), [notice, setNotice] = useMessageText('');
 useEffect(() => {
   setReading(false); setNotice('');
   return () => { request.current?.abort(); request.current = null; };
 }, [projectId, sourceAssetId]);
 const hasDraft = () => !!root.current?.querySelector('[data-uncommitted="true"], [data-draft]');
 const fill = async () => {
   if (!projectId || !sourceAssetId || locked || request.current) return;
   if (hasDraft()) { setNotice(message('metadata.finishEditing')); return; }
   const controller = new AbortController(); request.current = controller;
   setReading(true); setNotice('');
   const current = () => !controller.signal.aborted && latest.current.projectId === projectId && latest.current.sourceAssetId === sourceAssetId && !latest.current.locked;
   try {
     const source = await readSourceMetadata(projectId, sourceAssetId, controller.signal);
     if (!current()) return;
     if (hasDraft()) { setNotice(message('metadata.finishEditing')); return; }
     const commands = (['title','artist','album'] as const).filter(key => source[key].trim() && !latest.current.document.metadata[key]?.some(value => value.trim())).map(key => ({ type: 'set-metadata' as const, key, values: [source[key]] }));
     if (commands.length) { if (latest.current.apply({type:'batch', commands})) setNotice(message('metadata.filled')); }
     else setNotice(message(Object.values(source).some(value => value.trim()) ? 'metadata.noEmpty' : 'metadata.noTags'));
   } catch (cause) { if (current()) setNotice(errorMessage(cause)); }
   finally { if (request.current === controller) { request.current = null; setReading(false); } }
 };
 const identities=useRef(new Map<string,string>()), table=useRef<HTMLTableElement>(null), add=useRef<HTMLButtonElement>(null);
 const [drafts,setDrafts]=useState<string[]>([]);
 const identity=(key:string)=>{ if(!identities.current.has(key))identities.current.set(key,crypto.randomUUID());return identities.current.get(key)!; };
 const focusNext=(row:number)=>requestAnimationFrame(()=>{ const rows=table.current?.querySelectorAll('tbody tr'); const next=rows?.[Math.min(row,(rows?.length ?? 1)-1)]; (next?.querySelector('input,textarea') as HTMLElement | null)?.focus(); if(!next)add.current?.focus(); });
 return <div ref={root}><label className="management-language">{t('metadata.language')}<DraftInput value={document.language ?? ''} label={t('metadata.language')} placeholder="ja / zh-Hans" onCommit={language=>apply({type:'set-language',language:language || null})}/></label>
 <section aria-label={t('metadata.author')}><h3>{t('metadata.author')}</h3>
 <table className="management-table"><tbody><MetadataRow name="songwriter" values={document.metadata.songwriter ?? []} document={document} apply={apply} renamed={()=>{}} deleted={()=>{}} dedicated/></tbody></table></section>
 <section aria-label={t('metadata.amll')}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><h3>{t('metadata.amll')}</h3><button type="button" data-role="inline" disabled={!sourceAssetId || !projectId || locked || reading} aria-busy={reading} onClick={()=>void fill()}>{t(reading ? 'common.reading' : 'metadata.useSong')}</button></div>{notice && <p role="status">{notice}</p>}
 <datalist id="metadata-key-suggestions">{preferred.map(k=><option key={k} value={k}/>)}</datalist>
 <table className="management-table" ref={table}><colgroup><col style={{width:'27%'}}/><col/><col style={{width:80}}/></colgroup><thead><tr><th>{t('metadata.key')}</th><th>{t('metadata.value')}</th><th aria-label={t('common.actions')}/></tr></thead><tbody>
 {Object.entries(document.metadata).filter(([key])=>key !== 'songwriter').map(([key,values],index)=><MetadataRow key={identity(key)} name={key} values={values} apply={apply} document={document} deleted={()=>focusNext(index)} renamed={next=>{ identities.current.set(next,identity(key)); identities.current.delete(key); }}/>) }
 {drafts.map(id=><NewMetadata key={id} document={document} apply={apply} done={key=>{if(key) identities.current.set(key,id);setDrafts(d=>d.filter(x=>x!==id));requestAnimationFrame(()=>{if(key)table.current?.querySelector<HTMLTextAreaElement>(`tr[data-metadata-key="${CSS.escape(key)}"] textarea`)?.focus();else add.current?.focus();});}}/>)}
 </tbody></table><div className="management-footer"><button ref={add} data-role="inline" className="icon-button" aria-label={t('metadata.add')} title={t('metadata.add')} data-tooltip={t('metadata.add')} onClick={()=>setDrafts(d=>[...d,crypto.randomUUID()])}><Icon name="add"/></button><span>{t('metadata.emptyHelp')}</span></div></section></div>;
}
function MetadataRow({name,values,document,apply,renamed,deleted,dedicated = false}: Props & {name:string;values:string[];renamed:(name:string)=>void;deleted:()=>void;dedicated?:boolean}) {
  useTranslation();
 const [error,setError]=useMessageText(''),[extra,setExtra]=useState<string[]>([]);
 const valueIds=useRef<string[]>([]),row=useRef<HTMLTableRowElement>(null);
 while(valueIds.current.length<values.length)valueIds.current.push(crypto.randomUUID());
 const focusValue=(index:number)=>requestAnimationFrame(()=>{ (row.current?.querySelectorAll('textarea')[Math.max(0,Math.min(index,values.length-2))] as HTMLElement | undefined)?.focus(); });
 return <tr ref={row} data-metadata-key={name}><td>{dedicated ? <span>{t('metadata.authorLabel')}</span> : <TableField value={name} label={t('metadata.keyLabel',{name})} cancel={()=>setError('')} commit={next=>{
 if(next === 'songwriter'){setError(message('metadata.authorHelp'));return false;}
 if(!/^[A-Za-z][\w.-]*$/.test(next)||Object.hasOwn(document.metadata,next)){setError(message('metadata.invalidKey'));return false;}
 renamed(next);const ok=apply({type:'rename-metadata',key:name,nextKey:next});if(!ok)renamed(name);setError(ok?'':message('metadata.renameFailed'));return ok;
 }}/>}{error&&<p role="alert">{error}</p>}</td><td className="value-cell">
 {values.map((value,i)=><div key={valueIds.current[i]}><TableField multiline value={value} label={t('metadata.valueLabel',{name,index:i+1})} commit={text=>{const next=[...values];if(text.trim())next[i]=text.trim();else next.splice(i,1);if(apply({type:'set-metadata',key:name,values:next})){if(!text.trim()){valueIds.current.splice(i,1);if(next.length)focusValue(i);else deleted();}return true;}return false;}}/></div>)}
 {extra.map(id=><div key={id} data-draft><TableField multiline autoFocus value="" label={t('metadata.newValueLabel',{name})} cancel={()=>{setExtra(e=>e.filter(x=>x!==id));requestAnimationFrame(()=>row.current?.querySelectorAll('textarea')[Math.max(0,values.length-1)]?.focus());}} commit={text=>{if(!text.trim()){setExtra(e=>e.filter(x=>x!==id));return true;}valueIds.current[values.length]=id;if(apply({type:'set-metadata',key:name,values:[...values,text.trim()]})){setExtra(e=>e.filter(x=>x!==id));requestAnimationFrame(()=>row.current?.querySelectorAll('textarea')[values.length]?.focus());return true;}return false;}}/></div>)}
 </td><td><div className="row-actions"><IconButton icon="add" label={t('metadata.addValue',{name})} onClick={()=>setExtra(e=>[...e,crypto.randomUUID()])}/><IconButton icon="trash" data-role="danger" label={t('metadata.deleteKey',{name})} onClick={()=>{if(apply({type:'set-metadata',key:name,values:[]}))deleted();}}/></div></td></tr>;
}
function NewMetadata({document,apply,done}:Props & {done:(key?:string)=>void}) {
  useTranslation();
 const [name,setName]=useState(''),[value,setValue]=useState(''),[error,setError]=useMessageText('');
 const save=(key:string,text:string)=>{setName(key);setValue(text);if(key === 'songwriter'){setError(message('metadata.authorHelp'));return false;}if(!/^[A-Za-z][\w.-]*$/.test(key)||Object.hasOwn(document.metadata,key)){setError(message('metadata.invalidKey'));return false;}if(!text.trim()){setError(message('metadata.valueRequired'));return false;}if(apply({type:'set-metadata',key,values:[text.trim()]})){done(key);return true;}return false;};
 return <tr data-draft><td><TableField autoFocus value={name} label={t('metadata.newKey')} list="metadata-key-suggestions" cancel={()=>done()} commit={key=>save(key,value)}/>{error&&<p role="alert">{error}</p>}</td><td><TableField multiline value={value} label={t('metadata.newValue')} cancel={()=>done()} commit={text=>save(name,text)}/></td><td><div className="row-actions"><IconButton icon="trash" label={t('metadata.cancelAdd')} onClick={()=>done()}/></div></td></tr>;
}

const t=i18n.t.bind(i18n);
