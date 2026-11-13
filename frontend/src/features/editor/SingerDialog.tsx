import { useMessageText } from '../../shared/useMessageText';
import { message } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
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
  useTranslation();
 const identities=useRef(new Map<string,string>()),root=useRef<HTMLDivElement>(null),add=useRef<HTMLButtonElement>(null);
 const identity=(id:string)=>{if(!identities.current.has(id))identities.current.set(id,crypto.randomUUID());return identities.current.get(id)!;};
 const [adding,setAdding]=useState(false),[remove,setRemove]=useState<string|null>(null),[errors,setErrors]=useState<Record<string,string>>({});
 useEffect(()=>{if(focusAgent)root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(focusAgent)}"]`)?.focus();},[focusAgent]);
 const target=document.agents.find(a=>a.id===remove),direct=document.lines.filter(l=>l.agentRefs.includes(remove ?? '')),actors=document.agents.filter(a=>a.actorRef===remove);
 return <SettingsDialog title={t('editor.singers')} close={close}><div ref={root}>
 <table className="management-table"><colgroup><col style={{width:'14%'}}/><col style={{width:112}}/><col/><col style={{width:'30%'}}/><col style={{width:108}}/></colgroup><thead><tr><th>ID</th><th>type</th><th>name</th><th>actor</th><th aria-label={t('common.actions')}/></tr></thead><tbody>
 {document.agents.map((agent,index)=>{const valid=AGENT_TYPES.some(t=>t===agent.type);return <tr key={identity(agent.id)}><td><TableField value={agent.id} label={t('singer.idLabel',{id:agent.id})} commit={next=>{
 if(!/^[A-Za-z_][\w.-]*$/.test(next)||document.agents.some(a=>a.id===next)){setErrors(e=>({...e,[agent.id]:t('singer.invalidId')}));return false;}
 identities.current.set(next,identity(agent.id));const ok=apply({type:'rename-agent',id:agent.id,nextId:next});if(ok){identities.current.delete(agent.id);setErrors({});}else identities.current.delete(next);return ok;
 }}/>{errors[agent.id]&&<p role="alert">{errors[agent.id]}</p>}</td><td>
 <Select aria-label={t('singer.typeLabel',{id:agent.id})} data-agent-id={agent.id} value={agent.type ?? ''} aria-invalid={!valid} onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}} onChange={e=>apply({type:'set-agents',agents:document.agents.map(a=>a.id===agent.id?{...a,type:e.target.value}:a)})}>
 {!valid&&<option disabled value={agent.type ?? ''}>{agent.type ?? t('singer.missingType')}{t('singer.needsRepair')}</option>}{AGENT_TYPES.map(t=><option key={t}>{t}</option>)}</Select>{!valid&&<p role="alert">{t('singer.selectType')}</p>}</td><td><TableField value={agent.name ?? ''} label={t('singer.nameLabel',{id:agent.id})} commit={name=>apply({type:'set-agents',agents:document.agents.map(a=>a.id===agent.id?{...a,name:name||null}:a)})}/></td><td><ActorSelect document={document} id={agent.id} value={agent.actorRef ?? ''} onChange={actorRef=>apply({type:'set-agents',agents:document.agents.map(a=>{if(a.id!==agent.id)return a;const {actorRef:_,...rest}=a;return actorRef?{...rest,actorRef}:rest;})})}/></td><td><div className="row-actions">
 {([-1,1] as const).map(direction=><IconButton key={direction} icon={direction<0?'up':'down'} label={t(direction<0?'singer.up':'singer.down',{id:agent.id})} disabled={index+direction<0||index+direction>=document.agents.length} onClick={()=>{const agents=[...document.agents];[agents[index],agents[index+direction]]=[agents[index+direction],agents[index]];if(apply({type:'set-agents',agents}))requestAnimationFrame(()=>root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(agent.id)}"]`)?.focus());}}/>)}
 <IconButton icon="trash" data-role="danger" label={t('singer.delete',{id:agent.id})} onClick={()=>setRemove(agent.id)}/></div></td></tr>;})}
 {adding&&<NewSinger document={document} apply={apply} done={id=>{setAdding(false);requestAnimationFrame(()=>{if(id)root.current?.querySelector<HTMLSelectElement>(`select[data-agent-id="${CSS.escape(id)}"]`)?.focus();else add.current?.focus();});}}/>}
 </tbody></table><div className="management-footer"><button ref={add} className="icon-button" data-role="inline" aria-label={t('singer.add')} title={t('singer.add')} data-tooltip={t('singer.add')} onClick={()=>setAdding(true)}><Icon name="add"/></button><span>{t('singer.orderHelp')}</span></div>
 {target&&<SettingsDialog title={t('singer.delete',{id:target.id})} close={()=>setRemove(null)} actions={<><button data-dialog-close data-initial-focus data-role="secondary" onClick={()=>setRemove(null)}>{t('common.cancel')}</button><button data-role="danger-primary" onClick={()=>{if(apply({type:'delete-agent',id:target.id})){setRemove(null);requestAnimationFrame(()=>add.current?.focus());}}}>{t('common.confirmDelete')}</button></>}>
 <p>{t('singer.confirmDelete',{id:target.id,name:target.name?` (${target.name})`:''})}</p><p>{t('singer.references',{lines:direct.length,actors:actors.length})}</p><p>{t('singer.deleteHelp')}</p>
 </SettingsDialog>}
 </div></SettingsDialog>;
}
function NewSinger({document,apply,done}:{document:LyricDocument;apply:Props['apply'];done:(id?:string)=>void}) {
  useTranslation();
 const [id,setId]=useState(()=>{let n=1;while(document.agents.some(a=>a.id===`v${n}`))n++;return `v${n}`;}),[type,setType]=useState('person'),[name,setName]=useState(''),[error,setError]=useMessageText(''),[actorRef,setActorRef]=useState('');
 const save=(next:string)=>{setId(next);if(!/^[A-Za-z_][\w.-]*$/.test(next)||document.agents.some(a=>a.id===next)){setError(message('singer.invalidId'));return false;}if(apply({type:'set-agents',agents:[...document.agents,{id:next,type,name:name||null,...(actorRef?{actorRef}:{})}]})){done(next);return true;}return false;};
 return <tr data-draft><td><TableField autoFocus commitInitial value={id} label={t('singer.id')} cancel={()=>done()} commit={save}/>{error&&<p role="alert">{error}</p>}</td><td><Select aria-label={t('singer.newType')} value={type} onChange={e=>setType(e.target.value)}>{AGENT_TYPES.map(t=><option key={t}>{t}</option>)}</Select></td><td><TableField value={name} label={t('singer.name')} cancel={()=>done()} commit={v=>{setName(v);return true;}}/></td><td><ActorSelect document={document} id={id} value={actorRef} onChange={setActorRef}/></td><td><div className="row-actions"><IconButton icon="trash" label={t('singer.cancelAdd')} onPointerDown={e=>e.preventDefault()} onClick={()=>done()}/></div></td></tr>;
}

function ActorSelect({document,id,value,onChange}:{document:LyricDocument;id:string;value:string;onChange:(value:string)=>void}) {
 useTranslation();
 const candidates=document.agents.filter(a=>a.id!==id);
 const labels=Object.fromEntries(document.agents.map(a=>[a.id,{prefix:a.id+(a.name?' ':''),text:a.name??''}]));
 return <Select aria-label={t('singer.actorLabel',{id})} value={value} labels={labels} onChange={e=>onChange(e.target.value)}>
 <option value="">{t('singer.noActor')}</option>
 {value!==''&&value===id&&<option value={id} hidden disabled>{`${labels[id].prefix}${labels[id].text}`}</option>}
 {candidates.map(a=><option key={a.id} value={a.id}>{`${labels[a.id].prefix}${labels[a.id].text}`}</option>)}
 </Select>;
}

const t=i18n.t.bind(i18n);
