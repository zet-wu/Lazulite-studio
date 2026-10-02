import { Select } from '../../shared/Select';
import { Icon } from '../../shared/Icon';
import { useEffect, useRef, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { AGENT_TYPES, type LyricDocument } from '../../domain/lyric-document';
import { TableField } from './ManagementTable';
import { IconButton } from '../../shared/Controls';
import { SettingsDialog } from './SettingsDialog';
type Props={document:LyricDocument;apply:(command:LyricCommand)=>boolean;close:()=>void;focusAgent?:string};
export function SingerDialog({ document, apply, close, focusAgent }:Props) {
 const identities=useRef(new Map<string,string>()),root=useRef<HTMLDivElement>(null),add=useRef<HTMLButtonElement>(null);
 const identity=(id:string)=>{if(!identities.current.has(id))identities.current.set(id,crypto.randomUUID());return identities.current.get(id)!;};
 const [adding,setAdding]=useState(false),[remove,setRemove]=useState<string|null>(null),[errors,setErrors]=useState<Record<string,string>>({});
 useEffect(()=>{if(focusAgent)root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(focusAgent)}"]`)?.focus();},[focusAgent]);
 const target=document.agents.find(a=>a.id===remove),direct=document.lines.filter(l=>l.agentRefs.includes(remove ?? '')),actors=document.agents.filter(a=>a.actorRef===remove),backgrounds=document.lines.filter(l=>direct.some(parent=>parent.id===l.backgroundOf));
 return <SettingsDialog title="歌手管理" close={close}><div ref={root}>
 <table className="management-table"><colgroup><col style={{width:'20%'}}/><col style={{width:148}}/><col/><col style={{width:108}}/></colgroup><thead><tr><th>ID</th><th>type</th><th>名称</th><th aria-label="操作"/></tr></thead><tbody>
 {document.agents.map((agent,index)=>{const valid=AGENT_TYPES.some(t=>t===agent.type);return <tr key={identity(agent.id)}><td><TableField value={agent.id} label={`歌手 ID ${agent.id}`} commit={next=>{
 if(!/^[A-Za-z_][\w.-]*$/.test(next)||document.agents.some(a=>a.id===next)){setErrors(e=>({...e,[agent.id]:'歌手 ID 非法或已存在'}));return false;}
 identities.current.set(next,identity(agent.id));const ok=apply({type:'rename-agent',id:agent.id,nextId:next});if(ok){identities.current.delete(agent.id);setErrors({});}else identities.current.delete(next);return ok;
 }}/>{errors[agent.id]&&<p role="alert">{errors[agent.id]}</p>}</td><td>
 <Select aria-label={`歌手 ${agent.id} type`} data-agent-id={agent.id} value={agent.type ?? ''} aria-invalid={!valid} onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}} onChange={e=>apply({type:'set-agents',agents:document.agents.map(a=>a.id===agent.id?{...a,type:e.target.value}:a)})}>
 {!valid&&<option disabled value={agent.type ?? ''}>{agent.type ?? '缺少 type'}（待修）</option>}{AGENT_TYPES.map(t=><option key={t}>{t}</option>)}</Select>{!valid&&<p role="alert">请选择有效 type</p>}</td><td><TableField value={agent.name ?? ''} label={`歌手 ${agent.id}`} commit={name=>apply({type:'set-agents',agents:document.agents.map(a=>a.id===agent.id?{...a,name:name||null}:a)})}/></td><td><div className="row-actions">
 {([-1,1] as const).map(direction=><IconButton key={direction} icon={direction<0?'up':'down'} label={`${direction<0?'上移':'下移'}歌手 ${agent.id}`} disabled={index+direction<0||index+direction>=document.agents.length} onClick={()=>{const agents=[...document.agents];[agents[index],agents[index+direction]]=[agents[index+direction],agents[index]];if(apply({type:'set-agents',agents}))requestAnimationFrame(()=>root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(agent.id)}"]`)?.focus());}}/>)}
 <IconButton icon="trash" data-role="danger" label={`删除歌手 ${agent.id}`} onClick={()=>setRemove(agent.id)}/></div></td></tr>;})}
 {adding&&<NewSinger document={document} apply={apply} done={id=>{setAdding(false);requestAnimationFrame(()=>{if(id)root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(id)}"]`)?.focus();else add.current?.focus();});}}/>}
 </tbody></table><div className="management-footer"><button ref={add} className="icon-button" data-role="inline" aria-label="添加歌手" title="添加歌手" data-tooltip="添加歌手" onClick={()=>setAdding(true)}><Icon name="add"/></button><span>声明顺序影响 Studio 预览的基准侧。</span></div>
 {target&&<SettingsDialog title={`删除歌手 ${target.id}`} close={()=>setRemove(null)} actions={<><button data-initial-focus data-role="secondary" onClick={()=>setRemove(null)}>取消</button><button data-role="danger-primary" onClick={()=>{if(apply({type:'delete-agent',id:target.id})){setRemove(null);requestAnimationFrame(()=>add.current?.focus());}}}>确认删除</button></>}>
 <p>删除 {target.id}{target.name?`（${target.name}）`:''}？</p><p>直接歌词引用：{direct.length} 行；actor 引用：{actors.length} 个；背景继承影响：{backgrounds.length} 行。</p><p>移除此歌手定义及上述引用，保留歌词与其他歌手；引用清空后变为未指定。</p>
 </SettingsDialog>}
 </div></SettingsDialog>;
}
function NewSinger({document,apply,done}:{document:LyricDocument;apply:Props['apply'];done:(id?:string)=>void}) {
 const [id,setId]=useState(''),[type,setType]=useState('person'),[name,setName]=useState(''),[error,setError]=useState('');
 const save=(next:string)=>{setId(next);if(!/^[A-Za-z_][\w.-]*$/.test(next)||document.agents.some(a=>a.id===next)){setError('歌手 ID 非法或已存在');return false;}if(apply({type:'set-agents',agents:[...document.agents,{id:next,type,name:name||null}]})){done(next);return true;}return false;};
 return <tr data-draft><td><TableField autoFocus value={id} label="歌手 ID" cancel={()=>done()} commit={save}/>{error&&<p role="alert">{error}</p>}</td><td><Select aria-label="新歌手 type" value={type} onChange={e=>setType(e.target.value)}>{AGENT_TYPES.map(t=><option key={t}>{t}</option>)}</Select></td><td><TableField value={name} label="歌手名称" cancel={()=>done()} commit={v=>{setName(v);return true;}}/></td><td><div className="row-actions"><IconButton icon="trash" label="取消新增歌手" onClick={()=>done()}/></div></td></tr>;
}
