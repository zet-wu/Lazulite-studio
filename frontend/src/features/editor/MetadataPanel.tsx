import { Icon } from '../../shared/Icon';
import { useRef, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { DraftInput } from './EditorFields';
import { TableField } from './ManagementTable';
import { IconButton } from '../../shared/Controls';

const preferred = ['title','artist','album','songwriter','composer','lyricist','isrc'];
type Props = { document: LyricDocument; apply: (command: LyricCommand) => boolean };
export function MetadataPanel({ document, apply }: Props) {
 const identities=useRef(new Map<string,string>()), table=useRef<HTMLTableElement>(null), add=useRef<HTMLButtonElement>(null);
 const [drafts,setDrafts]=useState<string[]>([]);
 const identity=(key:string)=>{ if(!identities.current.has(key))identities.current.set(key,crypto.randomUUID());return identities.current.get(key)!; };
 const focusNext=(row:number)=>requestAnimationFrame(()=>{ const rows=table.current?.querySelectorAll('tbody tr'); const next=rows?.[Math.min(row,(rows?.length ?? 1)-1)]; (next?.querySelector('input,textarea') as HTMLElement | null)?.focus(); if(!next)add.current?.focus(); });
 return <div><label className="management-language">歌词语言 <DraftInput value={document.language ?? ''} label="歌词语言" placeholder="ja / zh-Hans" onCommit={language=>apply({type:'set-language',language:language || null})}/></label>
 <datalist id="metadata-key-suggestions">{preferred.map(k=><option key={k} value={k}/>)}</datalist>
 <table className="management-table" ref={table}><colgroup><col style={{width:'27%'}}/><col/><col style={{width:80}}/></colgroup><thead><tr><th>键</th><th>值</th><th aria-label="操作"/></tr></thead><tbody>
 {Object.entries(document.metadata).map(([key,values],index)=><MetadataRow key={identity(key)} name={key} values={values} apply={apply} document={document} deleted={()=>focusNext(index)} renamed={next=>{ identities.current.set(next,identity(key)); identities.current.delete(key); }}/>) }
 {drafts.map(id=><NewMetadata key={id} document={document} apply={apply} done={key=>{if(key) identities.current.set(key,id);setDrafts(d=>d.filter(x=>x!==id));if(!key)add.current?.focus();}}/>)}
 </tbody></table><div className="management-footer"><button ref={add} data-role="inline" className="icon-button" aria-label="新增元数据键" title="新增元数据键" data-tooltip="新增元数据键" onClick={()=>setDrafts(d=>[...d,crypto.randomUUID()])}><Icon name="add"/></button><span>清空值后提交将删除该值；末值清空会删除整键。</span></div></div>;
}
function MetadataRow({name,values,document,apply,renamed,deleted}: Props & {name:string;values:string[];renamed:(name:string)=>void;deleted:()=>void}) {
 const [error,setError]=useState(''),[extra,setExtra]=useState<string[]>([]);
 const valueIds=useRef<string[]>([]),row=useRef<HTMLTableRowElement>(null);
 while(valueIds.current.length<values.length)valueIds.current.push(crypto.randomUUID());
 const focusValue=(index:number)=>requestAnimationFrame(()=>{ (row.current?.querySelectorAll('textarea')[Math.max(0,Math.min(index,values.length-2))] as HTMLElement | undefined)?.focus(); });
 return <tr ref={row}><td><TableField value={name} label={`元数据键 ${name}`} commit={next=>{
 if(!/^[A-Za-z][\w.-]*$/.test(next)||Object.hasOwn(document.metadata,next)){setError('键名非法或已存在');return false;}
 renamed(next);const ok=apply({type:'rename-metadata',key:name,nextKey:next});if(!ok)renamed(name);setError(ok?'':'改名失败');return ok;
 }}/>{error&&<p role="alert">{error}</p>}</td><td className="value-cell">
 {values.map((value,i)=><div key={valueIds.current[i]}><TableField multiline value={value} label={`元数据 ${name} 值 ${i+1}`} commit={text=>{const next=[...values];if(text.trim())next[i]=text.trim();else next.splice(i,1);if(apply({type:'set-metadata',key:name,values:next})){if(!text.trim()){valueIds.current.splice(i,1);if(next.length)focusValue(i);else deleted();}return true;}return false;}}/></div>)}
 {extra.map(id=><div key={id} data-draft><TableField multiline autoFocus value="" label={`元数据 ${name} 新值`} cancel={()=>setExtra(e=>e.filter(x=>x!==id))} commit={text=>{if(!text.trim()){setExtra(e=>e.filter(x=>x!==id));return true;}valueIds.current[values.length]=id;if(apply({type:'set-metadata',key:name,values:[...values,text.trim()]})){setExtra(e=>e.filter(x=>x!==id));return true;}return false;}}/></div>)}
 </td><td><div className="row-actions"><IconButton icon="add" label={`为 ${name} 添加值`} onClick={()=>setExtra(e=>[...e,crypto.randomUUID()])}/><IconButton icon="trash" data-role="danger" label={`删除元数据 ${name} 及全部值`} onClick={()=>{if(apply({type:'set-metadata',key:name,values:[]}))deleted();}}/></div></td></tr>;
}
function NewMetadata({document,apply,done}:Props & {done:(key?:string)=>void}) {
 const [name,setName]=useState(''),[value,setValue]=useState(''),[error,setError]=useState('');
 const save=(key:string,text:string)=>{setName(key);setValue(text);if(!/^[A-Za-z][\w.-]*$/.test(key)||Object.hasOwn(document.metadata,key)){setError('键名非法或已存在');return false;}if(!text.trim()){setError('请填写至少一个值');return false;}if(apply({type:'set-metadata',key,values:[text.trim()]})){done(key);return true;}return false;};
 return <tr data-draft><td><TableField autoFocus value={name} label="新元数据键" list="metadata-key-suggestions" cancel={()=>done()} commit={key=>save(key,value)}/>{error&&<p role="alert">{error}</p>}</td><td><TableField multiline value={value} label="新元数据值" cancel={()=>done()} commit={text=>save(name,text)}/></td><td><div className="row-actions"><IconButton icon="trash" label="取消新增元数据" onClick={()=>done()}/></div></td></tr>;
}
