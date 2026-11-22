import { SettingField } from '../shared/SettingsFields';
import fields from '../shared/settings-fields.module.css';
import { SugSingersDialog } from './SugSingersDialog';
import { MessageError, errorMessage, message as describeMessage } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { TopMenu } from './editor/TopMenu';
import { SelectionSummary } from './editor/SelectionSummary';
import editorStyles from './editor/semantic-editor.module.css';
import { lineLabel } from './line-label';
import { SingerMarkersDialog } from './SingerMarkersDialog';
import { useState } from 'react';
import { anchorKey, anchorRange, cueProblem, type CueAnchor, type KaraokeCommand, type KaraokeCue, groupIdProblem, nextGroupId } from '../domain/karaoke';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { SettingsDialog } from './editor/SettingsDialog';
import { DraftInput, TimePair } from './editor/EditorFields';
import { useEditorSelection } from './editor/SelectionContext';
import { IconButton } from '../shared/Controls';
import styles from './karaoke.module.css';
import './editor/management-table.css';
export function downloadKaraoke(data: BlobPart, name: string, type: string) {
  const url=URL.createObjectURL(new Blob([data],{type})), link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function CueSlot({project, anchor, apply}: {project:ProjectDocument;anchor:CueAnchor;apply:(command:KaraokeCommand)=>void}) {
  useTranslation();
  const shared=useEditorSelection()!, cues=project.karaoke.cues.filter(cue=>anchorKey(cue.anchor)===anchorKey(anchor));
  const [editing,setEditing]=useState<string|null>(null),[error,setError]=useMessageText('');
  const run=(command:KaraokeCommand)=>{try{apply(command);setError('');return true;}catch(e){setError(errorMessage(e));return false;}};
  const render=(cue:KaraokeCue)=><span key={cue.id} className={styles.cue} role="button" tabIndex={0} data-cue-id={cue.id} aria-label={t('karaoke.cueLabel',{text:cue.text})} aria-pressed={shared.selectedCue===cue.id} onPointerDown={event=>event.stopPropagation()}
    onClick={event=>{event.stopPropagation();shared.selectCue(cue.id,cue.anchor.lineId);}} onDoubleClick={event=>{event.stopPropagation();setEditing(cue.id);}}
    onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();shared.selectCue(cue.id,cue.anchor.lineId);}if(event.key==='F2')setEditing(cue.id);if(event.key==='Delete'){event.stopPropagation();run({kind:'remove',id:cue.id});}}}>
    {editing===cue.id?<DraftInput value={cue.text} label={t('karaoke.cueText')} inputRef={node=>node?.focus()} onCommit={text=>{if(run({kind:'cue',id:cue.id,text,beginMs:cue.beginMs,endMs:cue.endMs}))setEditing(null);}}/>:cue.text}{error&&<small role="alert">{error}</small>}</span>;
  if(anchor.kind==='before')return <>{cues.sort((a,b)=>a.beginMs-b.beginMs).map(render)}</>;
  if(cues.length)return <>{cues.map(render)}</>;
  if(!anchorRange(project.lyrics,anchor))return null;
  return <button data-role="inline" className={styles.slot} aria-label={anchor.kind==='ruby'?t('karaoke.insertRuby'):t('karaoke.insertLine')} onClick={event=>{event.stopPropagation();if(event.detail>1)return;run({kind:'insert',anchor});}} onDoubleClick={event=>event.stopPropagation()}>＋</button>;
}
export function CueProperties({project,cue,apply}: {project:ProjectDocument;cue:KaraokeCue;apply:(command:KaraokeCommand)=>void}) {
  useTranslation();
  const problem=cueProblem(project.lyrics,project.karaoke,cue);
  return <><p>{t('karaoke.line')}{lineLabel(project.lyrics,project.lyrics.lines.find(line=>line.id===cue.anchor.lineId)!)}</p><p>{t('karaoke.oneSelected')}</p><div className={editorStyles.propertyQuote}><DraftInput value={cue.text} label={t('karaoke.cueText')} onCommit={text=>apply({kind:'cue',id:cue.id,text,beginMs:cue.beginMs,endMs:cue.endMs})}/></div>
    <TimePair begin={cue.beginMs} end={cue.endMs} label={t('karaoke.cue')} onCommit={(beginMs,endMs)=>{if(beginMs===null||endMs===null)throw new MessageError(describeMessage('karaoke.bothEnds'));apply({kind:'cue',id:cue.id,text:cue.text,beginMs,endMs});}}/>
    {problem&&<p role="alert">{t(problem)}</p>}</>;
}
export function KaraokeTools({project,apply}: {project:ProjectDocument;apply:(command:ProjectCommand)=>void}) {
  useTranslation();
 const {selection,selectedCue}=useEditorSelection()!;
 const [dialog,setDialog]=useState<'groups'|'defaults'|'auto'|'singers'|'sug-singers'|null>(null), [error,setError]=useMessageText('');
 const [activeMenuId,setActiveMenuId]=useState<string|null>(null);
 const [autoGroups,setAutoGroups]=useState<string[]|null>(null);
 const command=(c:KaraokeCommand)=>{try{apply({type:'karaoke',command:c});setError('');return true;}catch(e){setError(errorMessage(e));return false;}};
 return <><div className={editorStyles.ribbon} aria-label={t('karaoke.actions')}>
 <SelectionSummary selection={selection} selectedCue={selectedCue} />
 <TopMenu id="cue-tools" title={t('karaoke.guides')} className={editorStyles.ribbonMenu} activeMenuId={activeMenuId} onMenuChange={setActiveMenuId}><button data-role="inline" onClick={()=>(setError(''),setDialog('auto'))}>{t('karaoke.autoInsert')}</button><button data-role="inline" onClick={()=>(setError(''),setDialog('defaults'))}>{t('karaoke.defaults')}</button></TopMenu>
 <button data-role="secondary" onClick={()=>(setError(''),setDialog('groups'))}>{t('karaoke.groups')}</button><button data-role="secondary" onClick={()=>(setError(''),setDialog('singers'))}>{t('karaoke.singerMarkers')}</button><button data-role="secondary" onClick={()=>(setError(''),setDialog('sug-singers'))}>{t('karaoke.sugSingers')}</button></div>
 {error&&!dialog&&<p role="alert">{error}</p>}
 {dialog==='sug-singers'&&<SugSingersDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='singers'&&<SingerMarkersDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='auto'&&<AutoInsertDialog initialGroups={autoGroups} rememberGroups={setAutoGroups} error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='defaults'&&<DefaultsDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='groups'&&<GroupsDialog error={error} project={project} close={()=>setDialog(null)} apply={c=>{const ok=command(c);if(ok&&c.kind==='groups')setAutoGroups(ids=>ids?.flatMap(id=>c.renames[id]?[c.renames[id]]:[])??null);return ok;}}/>}
</>;
}
function DefaultsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
  useTranslation();
 const [value,setValue]=useState(project.karaoke.defaults);
 return <SettingsDialog title={t('karaoke.defaults')} returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close} actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" onClick={()=>{if(apply({kind:'settings',defaults:value}))close();}}>{t('common.apply')}</button></>}>
 <SettingField label={t('karaoke.cueText')} description={t('karaoke.defaultHelp')} error={error}><input id="cue-default-text" value={value.text} onChange={e=>setValue({...value,text:e.target.value})}/></SettingField></SettingsDialog>;
}
function AutoInsertDialog({project,close,apply,error,initialGroups,rememberGroups}:{initialGroups:string[]|null;rememberGroups:(ids:string[])=>void;error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
  useTranslation();
 const [groups,setGroups]=useState(initialGroups?.filter(id=>project.karaoke.groups.some(group=>group.id===id))??project.karaoke.groups.map(group=>group.id));
 const [thresholds,setThresholds]=useState(Object.fromEntries((['beforeMs','wordMs','rubyMs'] as const).map(key=>[key,String(project.karaoke.defaults[key])])));
 const [attempted,setAttempted]=useState(false);
 const invalid=(value:string)=>!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value));
 return <SettingsDialog title={t('karaoke.autoInsert')} returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close} actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={!groups.length} onClick={()=>{
 setAttempted(true);
 if(Object.values(thresholds).some(invalid)){document.querySelector<HTMLInputElement>(`#threshold-${Object.keys(thresholds).find(key=>invalid(thresholds[key]))}`)?.focus();return;}
 if(apply({kind:'auto',groupIds:groups,thresholds:{beforeMs:Number(thresholds.beforeMs),wordMs:Number(thresholds.wordMs),rubyMs:Number(thresholds.rubyMs)}})){rememberGroups(groups);close();}
 }}>{t('karaoke.insert')}</button></>}>
 <fieldset className={fields.group}><legend>{t('karaoke.targetGroups')}</legend>{project.karaoke.groups.map(group=><label className={styles.output} key={group.id}><input type="checkbox" checked={groups.includes(group.id)} onChange={e=>setGroups(e.target.checked?[...groups,group.id]:groups.filter(id=>id!==group.id))}/>{group.name}</label>)}</fieldset>
 <div className={fields.group}>{([['beforeMs',t('karaoke.beforeThreshold')],['wordMs',t('karaoke.wordThreshold')],['rubyMs',t('karaoke.rubyThreshold')]] as const).map(([key,label])=><SettingField key={key} label={label+t('karaoke.msSuffix')} error={attempted&&invalid(thresholds[key])?t('karaoke.invalidThreshold'):undefined} errorId={`threshold-${key}-error`}><input id={`threshold-${key}`} aria-label={label} aria-invalid={attempted&&invalid(thresholds[key])} aria-describedby={attempted&&invalid(thresholds[key])?`threshold-${key}-error`:undefined} type="number" min={0} step={1} value={thresholds[key]} onChange={e=>setThresholds({...thresholds,[key]:e.target.value})}/></SettingField>)}</div>
 {error&&<p role="alert">{error}</p>}</SettingsDialog>;
}
function GroupsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
  useTranslation();
 const [rows,setRows]=useState(()=>project.karaoke.groups.map(group=>({...group,key:crypto.randomUUID(),originalId:group.id})));
 const groups=rows.map(({id,name})=>({id:id.trim(),name}));
 const renames=Object.fromEntries(rows.filter(row=>row.originalId).map(row=>[row.originalId,row.id.trim()]));
 const problem=groupIdProblem(project.karaoke.groups,groups,renames);
 const removed=project.karaoke.groups.filter(group=>!rows.some(row=>row.originalId===group.id));
 const count=Object.values(project.karaoke.lineGroups).filter(id=>removed.some(group=>group.id===id)).length;
 const update=(key:string,patch:Partial<typeof rows[number]>)=>setRows(rows.map(row=>row.key===key?{...row,...patch}:row));
 return <SettingsDialog title={t('karaoke.groups')} close={close} actions={<button data-role="primary" disabled={!!problem} onClick={()=>{if(apply({kind:'groups',groups,renames}))close();}}>{t('karaoke.applyGroups')}</button>}>
 <table className="management-table"><colgroup><col style={{width:'30%'}}/><col/><col style={{width:108}}/></colgroup><thead><tr><th>ID</th><th>{t('karaoke.name')}</th><th aria-label={t('karaoke.operation')}/></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}>
 <td><input aria-label={t('karaoke.groupId',{number:index+1})} aria-invalid={(problem?.values?.number===index+1)||false} aria-describedby={(problem?.values?.number===index+1)?'group-id-error':undefined} value={row.id} onChange={event=>update(row.key,{id:event.target.value})}/>{(problem?.values?.number===index+1)&&<small id="group-id-error" role="alert">{formatMessage(problem!)}</small>}</td>
 <td><input aria-label={t('karaoke.groupName',{number:index+1})} value={row.name} onChange={event=>update(row.key,{name:event.target.value})}/></td>
 <td><div className="row-actions">{([-1,1] as const).map(direction=><IconButton key={direction} icon={direction<0?'up':'down'} label={t('karaoke.moveGroup',{direction:t(direction<0?'translation.up':'translation.down'),number:index+1})} disabled={index+direction<0||index+direction>=rows.length} onClick={()=>{const next=[...rows];[next[index],next[index+direction]]=[next[index+direction],next[index]];setRows(next);}}/>)}<IconButton icon="trash" label={t('karaoke.deleteGroup',{number:index+1})} data-role="danger" onClick={()=>setRows(rows.filter(item=>item.key!==row.key))}/></div></td>
 </tr>)}</tbody></table>
 <div className="management-footer"><IconButton icon="add" label={t('karaoke.addGroup')} onClick={()=>setRows([...rows,{id:nextGroupId([...project.karaoke.groups,...groups]),name:t('karaoke.newGroup'),key:crypto.randomUUID(),originalId:''}])}/></div>
 {count>0&&<p>{t('karaoke.ungrouped',{count})}</p>}{error&&<p role="alert">{error}</p>}
 </SettingsDialog>;
}


const t=i18n.t.bind(i18n);
