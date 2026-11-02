import { MessageError, errorMessage, message as describeMessage } from '../domain/messages';
import { issueText, karaokeOutputLabel } from './output-messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { prepareSug, sugZip } from '../adapters/sug';
export type KaraokeExportFormat = 'nicokara' | 'sug';
import { TopMenu } from './editor/TopMenu';
import { SelectionSummary } from './editor/SelectionSummary';
import editorStyles from './editor/semantic-editor.module.css';
import { lineLabel } from './line-label';
import { SingerMarkersDialog } from './SingerMarkersDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { anchorKey, anchorRange, cueProblem, type CueAnchor, type KaraokeCommand, type KaraokeCue, groupIdProblem, nextGroupId } from '../domain/karaoke';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { karaokeOutputs, nicokaraZip, prepareNicokara, safeFilename } from '../adapters/nicokara';
import { SettingsDialog } from './editor/SettingsDialog';
import { DraftInput, TimePair } from './editor/EditorFields';
import { useEditorSelection } from './editor/SelectionContext';
import { IconButton } from '../shared/Controls';
import type { OutputIssue } from '../adapters/output-validation';
import styles from './karaoke.module.css';
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
export function KaraokeTools({project,apply,title,exportOpen,setExportOpen,viewIssues,focusOutputId}: {project:ProjectDocument;apply:(command:ProjectCommand)=>void;title:string;focusOutputId?:string;exportOpen:KaraokeExportFormat|null;setExportOpen:(open:KaraokeExportFormat|null)=>void;viewIssues:(format:KaraokeExportFormat)=>void}) {
  useTranslation();
 const {selection,selectedCue}=useEditorSelection()!;
 const [dialog,setDialog]=useState<'groups'|'defaults'|'auto'|'singers'|null>(null), [error,setError]=useMessageText('');
 const [activeMenuId,setActiveMenuId]=useState<string|null>(null);
 const [autoGroups,setAutoGroups]=useState<string[]|null>(null);
 const command=(c:KaraokeCommand)=>{try{apply({type:'karaoke',command:c});setError('');return true;}catch(e){setError(errorMessage(e));return false;}};
 return <><div className={editorStyles.ribbon} aria-label={t('karaoke.actions')}>
 <SelectionSummary selection={selection} selectedCue={selectedCue} />
 <TopMenu id="cue-tools" title={t('karaoke.guides')} className={editorStyles.ribbonMenu} activeMenuId={activeMenuId} onMenuChange={setActiveMenuId}><button data-role="inline" onClick={()=>(setError(''),setDialog('auto'))}>{t('karaoke.autoInsert')}</button><button data-role="inline" onClick={()=>(setError(''),setDialog('defaults'))}>{t('karaoke.defaults')}</button></TopMenu>
 <button data-role="secondary" onClick={()=>(setError(''),setDialog('groups'))}>{t('karaoke.groups')}</button><button data-role="secondary" onClick={()=>(setError(''),setDialog('singers'))}>{t('karaoke.singerMarkers')}</button><button data-karaoke-export="nicokara" data-role="primary" onClick={()=>setExportOpen('nicokara')}>{t('karaoke.exportNico')}</button><button data-karaoke-export="sug" data-role="primary" onClick={()=>setExportOpen('sug')}>{t('karaoke.exportSUG')}</button></div>
 {error&&!dialog&&<p role="alert">{error}</p>}
 {dialog==='singers'&&<SingerMarkersDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='auto'&&<AutoInsertDialog initialGroups={autoGroups} rememberGroups={setAutoGroups} error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='defaults'&&<DefaultsDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='groups'&&<GroupsDialog error={error} project={project} close={()=>setDialog(null)} apply={c=>{const ok=command(c);if(ok&&c.kind==='groups')setAutoGroups(ids=>ids?.flatMap(id=>c.renames[id]?[c.renames[id]]:[])??null);return ok;}}/>}
 {exportOpen&&<KaraokeExport focusOutputId={focusOutputId} format={exportOpen} project={project} title={title} apply={command} close={()=>setExportOpen(null)} viewIssues={()=>{setExportOpen(null);viewIssues(exportOpen);}}/>}</>;
}
function DefaultsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
  useTranslation();
 const [value,setValue]=useState(project.karaoke.defaults);
 return <SettingsDialog title={t('karaoke.defaults')} returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close}>{error&&<p role="alert">{error}</p>}<div className={styles.defaults}><label htmlFor="cue-default-text">{t('karaoke.cueText')}</label><input id="cue-default-text" value={value.text} onChange={e=>setValue({...value,text:e.target.value})}/>
</div><p>{t('karaoke.defaultHelp')}</p><button data-role="primary" onClick={()=>{if(apply({kind:'settings',defaults:value}))close();}}>{t('common.apply')}</button></SettingsDialog>;
}
function AutoInsertDialog({project,close,apply,error,initialGroups,rememberGroups}:{initialGroups:string[]|null;rememberGroups:(ids:string[])=>void;error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
  useTranslation();
 const [groups,setGroups]=useState(initialGroups?.filter(id=>project.karaoke.groups.some(group=>group.id===id))??project.karaoke.groups.map(group=>group.id));
 const [thresholds,setThresholds]=useState(Object.fromEntries((['beforeMs','wordMs','rubyMs'] as const).map(key=>[key,String(project.karaoke.defaults[key])])));
 const [inputError,setInputError]=useMessageText('');
 return <SettingsDialog title={t('karaoke.autoInsert')} returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close}>{(inputError||error)&&<p role="alert">{inputError||error}</p>}
 <fieldset><legend>{t('karaoke.targetGroups')}</legend>{project.karaoke.groups.map(group=><label className={styles.output} key={group.id}><input type="checkbox" checked={groups.includes(group.id)} onChange={e=>setGroups(e.target.checked?[...groups,group.id]:groups.filter(id=>id!==group.id))}/>{group.name}</label>)}</fieldset>
 <div className={styles.thresholds}>{([['beforeMs',t('karaoke.beforeThreshold')],['wordMs',t('karaoke.wordThreshold')],['rubyMs',t('karaoke.rubyThreshold')]] as const).map(([key,label])=><label key={key}><span>{label}{t('karaoke.msSuffix')}</span><input aria-label={label} type="number" min={0} step={1} value={thresholds[key]} onChange={e=>setThresholds({...thresholds,[key]:e.target.value})}/></label>)}</div>
 <button data-role="primary" disabled={!groups.length} onClick={()=>{
 if(Object.values(thresholds).some(value=>!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))){setInputError(describeMessage('karaoke.invalidThreshold'));return;}
 setInputError('');
 if(apply({kind:'auto',groupIds:groups,thresholds:{beforeMs:Number(thresholds.beforeMs),wordMs:Number(thresholds.wordMs),rubyMs:Number(thresholds.rubyMs)}})){rememberGroups(groups);close();}
 }}>{t('karaoke.insert')}</button></SettingsDialog>;
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
 return <SettingsDialog title={t('karaoke.groups')} close={close}>
 <table className={styles.groupTable}><thead><tr><th>ID</th><th>{t('karaoke.name')}</th><th aria-label={t('karaoke.operation')}/></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}>
 <td><input aria-label={t('karaoke.groupId',{number:index+1})} aria-invalid={(problem?.values?.number===index+1)||false} aria-describedby={(problem?.values?.number===index+1)?'group-id-error':undefined} value={row.id} onChange={event=>update(row.key,{id:event.target.value})}/>{(problem?.values?.number===index+1)&&<small id="group-id-error" role="alert">{formatMessage(problem!)}</small>}</td>
 <td><input aria-label={t('karaoke.groupName',{number:index+1})} value={row.name} onChange={event=>update(row.key,{name:event.target.value})}/></td>
 <td><div className={styles.groupActions}>{([-1,1] as const).map(direction=><IconButton key={direction} icon={direction<0?'up':'down'} label={t('karaoke.moveGroup',{direction:t(direction<0?'translation.up':'translation.down'),number:index+1})} disabled={index+direction<0||index+direction>=rows.length} onClick={()=>{const next=[...rows];[next[index],next[index+direction]]=[next[index+direction],next[index]];setRows(next);}}/>)}<IconButton icon="trash" label={t('karaoke.deleteGroup',{number:index+1})} data-role="danger" onClick={()=>setRows(rows.filter(item=>item.key!==row.key))}/></div></td>
 </tr>)}</tbody></table>
 <IconButton icon="add" label={t('karaoke.addGroup')} onClick={()=>setRows([...rows,{id:nextGroupId([...project.karaoke.groups,...groups]),name:t('karaoke.newGroup'),key:crypto.randomUUID(),originalId:''}])}/>
 {count>0&&<p>{t('karaoke.ungrouped',{count})}</p>}{error&&<p role="alert">{error}</p>}
 <button data-role="primary" disabled={!!problem} onClick={()=>{if(apply({kind:'groups',groups,renames}))close();}}>{t('karaoke.applyGroups')}</button>
 </SettingsDialog>;
}

export function KaraokeExport({project,title,apply,close,viewIssues,focusOutputId,format='nicokara'}:{focusOutputId?:string;format?:KaraokeExportFormat;project:ProjectDocument;title:string;apply:(c:KaraokeCommand)=>boolean;close:()=>void;viewIssues:(issues:OutputIssue[])=>void}) {
  useTranslation();
 const prepare=format==='sug'?prepareSug:prepareNicokara;
 const result=useMemo(()=>prepare(project,title),[project,title,prepare]);const [error,setError]=useMessageText('');
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[invalid,setInvalid]=useState<Set<string>>(new Set());
 const inputs=useRef(new Map<string,HTMLInputElement>());
 useEffect(()=>{if(focusOutputId)inputs.current.get(focusOutputId)?.focus();},[focusOutputId]);
 const valid=(value:string)=>/^[+-]?\d+$/.test(value)&&Number.isSafeInteger(Number(value));
 const commit=(ids:string[])=>{
   const bad=ids.filter(id=>drafts[id]!==undefined&&!valid(drafts[id]));
   setInvalid(previous=>new Set([...previous].filter(id=>!ids.includes(id)).concat(bad)));
   if(bad.length)return {bad,project};
   const offsets=Object.fromEntries(ids.filter(id=>drafts[id]!==undefined).map(id=>[id,Number(drafts[id])]));
   if(Object.keys(offsets).length&&!apply({kind:'offsets',offsets}))return null;
   setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!ids.includes(id))));
   return {bad,project:{...project,karaoke:{...project.karaoke,offsets:{...project.karaoke.offsets,...offsets}}}};
 };
 const download=()=>{
   const submitted=commit(project.karaoke.outputs);if(!submitted)return;
   if(submitted.bad.length){inputs.current.get(submitted.bad[0])?.focus();return;}
   try{downloadKaraoke((format==='sug'?sugZip:nicokaraZip)(submitted.project,title),`${safeFilename(title)}-${format}.zip`,'application/zip');setError('');}catch(e){setError(errorMessage(e));}
 };
 const check=()=>{const submitted=commit(project.karaoke.outputs);if(!submitted)return;if(submitted.bad.length){inputs.current.get(submitted.bad[0])?.focus();return;}viewIssues(prepare(submitted.project,title).issues);};
 return <SettingsDialog returnFocus={()=>document.querySelector<HTMLElement>(`[data-karaoke-export="${format}"]`)} title={format==='sug'?t('karaoke.exportSUG'):t('karaoke.exportNicoTitle')} close={close} actions={<><button data-role="secondary" onClick={check}>{t('karaoke.check')}</button><button data-role="primary" onClick={download}>{t('karaoke.downloadZip')}</button></>}>
 <p id="offset-help">{t('karaoke.offsetHelp')}</p>
 <div className={styles.outputGrid}><span>{t('karaoke.outputFile')}</span><span>{format==='sug'?t('karaoke.offset'):'@Offset'}</span>{karaokeOutputs(project).map(output=>{
   const selected=project.karaoke.outputs.includes(output.id);
   return <div className={styles.outputRow} key={output.id}><label className={styles.output}><input type="checkbox" checked={selected} onChange={e=>apply({kind:'outputs',outputs:e.target.checked?[...project.karaoke.outputs,output.id]:project.karaoke.outputs.filter(id=>id!==output.id)})}/>{karaokeOutputLabel(output,project)}</label>
   <input className={styles.offset} aria-label={`${karaokeOutputLabel(output,project)} ${format==='sug'?t('karaoke.offset'):'@Offset'}`} aria-describedby="offset-help" aria-invalid={invalid.has(output.id)} disabled={!selected} value={drafts[output.id]??String(project.karaoke.offsets[output.id]??0)} ref={node=>{if(node)inputs.current.set(output.id,node);else inputs.current.delete(output.id);}}
   onChange={e=>{const value=e.target.value;setDrafts(previous=>({...previous,[output.id]:value}));if(valid(value))setInvalid(previous=>new Set([...previous].filter(id=>id!==output.id)));}}
   onBlur={()=>{if(selected)commit([output.id]);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commit([output.id]);}}}/></div>;
 })}</div>
 <p role="status">{t('karaoke.outputSummary',{files:result.files.length,issues:result.issues.length})}</p>{result.issues.length>0&&<p>{issueText(result.issues[0],project.lyrics)}</p>}{result.omitted.length>0&&<p>{t('karaoke.omitted',{count:result.omitted.length})}</p>}
 {error&&<p role="alert">{error}</p>}</SettingsDialog>;
}

const t=i18n.t.bind(i18n);
