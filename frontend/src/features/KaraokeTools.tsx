import { TopMenu } from './editor/TopMenu';
import editorStyles from './editor/semantic-editor.module.css';
import { lineLabel } from '../domain/line-structure';
import { SingerMarkersDialog } from './SingerMarkersDialog';
import { useMemo, useState } from 'react';
import { anchorKey, anchorRange, cueProblem, type CueAnchor, type KaraokeCommand, type KaraokeCue } from '../domain/karaoke';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { karaokeOutputs, nicokaraZip, prepareNicokara, safeFilename } from '../adapters/nicokara';
import { SettingsDialog } from './editor/SettingsDialog';
import { DraftInput, TimePair } from './editor/EditorFields';
import { useEditorSelection } from './editor/SelectionContext';
import { IconButton } from '../shared/Controls';
import { groupIdProblem, nextGroupId } from '../domain/karaoke';
import type { OutputIssue } from '../adapters/output-validation';
import styles from './karaoke.module.css';
export function downloadKaraoke(data: BlobPart, name: string, type: string) {
  const url=URL.createObjectURL(new Blob([data],{type})), link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function CueSlot({project, anchor, apply}: {project:ProjectDocument;anchor:CueAnchor;apply:(command:KaraokeCommand)=>void}) {
  const shared=useEditorSelection()!, cues=project.karaoke.cues.filter(cue=>anchorKey(cue.anchor)===anchorKey(anchor));
  const [editing,setEditing]=useState<string|null>(null),[error,setError]=useState('');
  const run=(command:KaraokeCommand)=>{try{apply(command);setError('');return true;}catch(e){setError((e as Error).message);return false;}};
  const render=(cue:KaraokeCue)=><span key={cue.id} className={styles.cue} role="button" tabIndex={0} data-cue-id={cue.id} aria-label={`导唱 ${cue.text}`} aria-pressed={shared.selectedCue===cue.id} onPointerDown={event=>event.stopPropagation()}
    onClick={event=>{event.stopPropagation();shared.selectCue(cue.id,cue.anchor.lineId);}} onDoubleClick={event=>{event.stopPropagation();setEditing(cue.id);}}
    onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();shared.selectCue(cue.id,cue.anchor.lineId);}if(event.key==='F2')setEditing(cue.id);if(event.key==='Delete'){event.stopPropagation();run({kind:'remove',id:cue.id});}}}>
    {editing===cue.id?<DraftInput value={cue.text} label="导唱文字" inputRef={node=>node?.focus()} onCommit={text=>{if(run({kind:'cue',id:cue.id,text,beginMs:cue.beginMs,endMs:cue.endMs}))setEditing(null);}}/>:cue.text}{error&&<small role="alert">{error}</small>}</span>;
  if(anchor.kind==='before')return <>{cues.sort((a,b)=>a.beginMs-b.beginMs).map(render)}</>;
  if(cues.length)return <>{cues.map(render)}</>;
  if(!anchorRange(project.lyrics,anchor))return null;
  return <button data-role="inline" className={styles.slot} aria-label={anchor.kind==='ruby'?'插入 Ruby 内导唱':'插入行内导唱'} onClick={event=>{event.stopPropagation();if(event.detail>1)return;run({kind:'insert',anchor});}} onDoubleClick={event=>event.stopPropagation()}>＋</button>;
}
export function CueProperties({project,cue,apply}: {project:ProjectDocument;cue:KaraokeCue;apply:(command:KaraokeCommand)=>void}) {
  const problem=cueProblem(project.lyrics,project.karaoke,cue);
  return <><p>所在行：{lineLabel(project.lyrics,project.lyrics.lines.find(line=>line.id===cue.anchor.lineId)!)}</p><p>导唱：已选 1</p><div className={editorStyles.propertyQuote}><DraftInput value={cue.text} label="导唱文字" onCommit={text=>apply({kind:'cue',id:cue.id,text,beginMs:cue.beginMs,endMs:cue.endMs})}/></div>
    <TimePair begin={cue.beginMs} end={cue.endMs} label="导唱" onCommit={(beginMs,endMs)=>{if(beginMs===null||endMs===null)throw new Error('导唱需要完整双端');apply({kind:'cue',id:cue.id,text:cue.text,beginMs,endMs});}}/>
    {problem&&<p role="alert">{problem}</p>}</>;
}
export function KaraokeTools({project,apply,title,exportOpen,setExportOpen,viewIssues}: {project:ProjectDocument;apply:(command:ProjectCommand)=>void;title:string;exportOpen:boolean;setExportOpen:(open:boolean)=>void;viewIssues:(issues:OutputIssue[])=>void}) {
 const [dialog,setDialog]=useState<'groups'|'defaults'|'auto'|'singers'|null>(null), [error,setError]=useState('');
 const [activeMenuId,setActiveMenuId]=useState<string|null>(null);
 const [autoGroups,setAutoGroups]=useState<string[]|null>(null);
 const command=(c:KaraokeCommand)=>{try{apply({type:'karaoke',command:c});setError('');return true;}catch(e){setError((e as Error).message);return false;}};
 return <><div className={styles.tools}>
 <TopMenu id="cue-tools" title="导唱符 ▾" className={editorStyles.settingsMenu} activeMenuId={activeMenuId} onMenuChange={setActiveMenuId}><button data-role="inline" onClick={()=>(setError(''),setDialog('auto'))}>自动插入导唱符</button><button data-role="inline" onClick={()=>(setError(''),setDialog('defaults'))}>默认导唱符</button></TopMenu>
 <button data-role="secondary" onClick={()=>(setError(''),setDialog('groups'))}>分组管理</button><button data-role="secondary" onClick={()=>(setError(''),setDialog('singers'))}>歌手标记管理</button><button data-role="primary" onClick={()=>setExportOpen(true)}>导出 NicoKara</button></div>
 {error&&!dialog&&<p role="alert">{error}</p>}
 {dialog==='singers'&&<SingerMarkersDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='auto'&&<AutoInsertDialog initialGroups={autoGroups} rememberGroups={setAutoGroups} error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='defaults'&&<DefaultsDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='groups'&&<GroupsDialog error={error} project={project} close={()=>setDialog(null)} apply={c=>{const ok=command(c);if(ok&&c.kind==='groups')setAutoGroups(ids=>ids?.flatMap(id=>c.renames[id]?[c.renames[id]]:[])??null);return ok;}}/>}
 {exportOpen&&<KaraokeExport project={project} title={title} apply={command} close={()=>setExportOpen(false)} viewIssues={issues=>{setExportOpen(false);viewIssues(issues);}}/>}</>;
}
function DefaultsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [value,setValue]=useState(project.karaoke.defaults);
 return <SettingsDialog title="默认导唱符" returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close}>{error&&<p role="alert">{error}</p>}<div className={styles.defaults}><label htmlFor="cue-default-text">导唱文字</label><input id="cue-default-text" value={value.text} onChange={e=>setValue({...value,text:e.target.value})}/>
</div><p>默认文字只影响之后新增的导唱。</p><button data-role="primary" onClick={()=>{if(apply({kind:'settings',defaults:value}))close();}}>应用</button></SettingsDialog>;
}
function AutoInsertDialog({project,close,apply,error,initialGroups,rememberGroups}:{initialGroups:string[]|null;rememberGroups:(ids:string[])=>void;error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [groups,setGroups]=useState(initialGroups?.filter(id=>project.karaoke.groups.some(group=>group.id===id))??project.karaoke.groups.map(group=>group.id));
 const [thresholds,setThresholds]=useState(Object.fromEntries((['beforeMs','wordMs','rubyMs'] as const).map(key=>[key,String(project.karaoke.defaults[key])])));
 const [inputError,setInputError]=useState('');
 return <SettingsDialog title="自动插入导唱符" returnFocus={()=>document.querySelector<HTMLElement>('[data-top-menu="cue-tools"] summary')} close={close}>{(inputError||error)&&<p role="alert">{inputError||error}</p>}
 <fieldset><legend>目标输出分组</legend>{project.karaoke.groups.map(group=><label className={styles.output} key={group.id}><input type="checkbox" checked={groups.includes(group.id)} onChange={e=>setGroups(e.target.checked?[...groups,group.id]:groups.filter(id=>id!==group.id))}/>{group.name}</label>)}</fieldset>
 <div className={styles.thresholds}>{([['beforeMs','行前阈值'],['wordMs','正文行内阈值'],['rubyMs','Ruby 内阈值']] as const).map(([key,label])=><label key={key}><span>{label}（毫秒）</span><input aria-label={label} type="number" min={0} step={1} value={thresholds[key]} onChange={e=>setThresholds({...thresholds,[key]:e.target.value})}/></label>)}</div>
 <button data-role="primary" disabled={!groups.length} onClick={()=>{
 if(Object.values(thresholds).some(value=>!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))){setInputError('阈值须为非负整数');return;}
 setInputError('');
 if(apply({kind:'auto',groupIds:groups,thresholds:{beforeMs:Number(thresholds.beforeMs),wordMs:Number(thresholds.wordMs),rubyMs:Number(thresholds.rubyMs)}})){rememberGroups(groups);close();}
 }}>插入</button></SettingsDialog>;
}
function GroupsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [rows,setRows]=useState(()=>project.karaoke.groups.map(group=>({...group,key:crypto.randomUUID(),originalId:group.id})));
 const groups=rows.map(({id,name})=>({id:id.trim(),name}));
 const renames=Object.fromEntries(rows.filter(row=>row.originalId).map(row=>[row.originalId,row.id.trim()]));
 const problem=groupIdProblem(project.karaoke.groups,groups,renames);
 const removed=project.karaoke.groups.filter(group=>!rows.some(row=>row.originalId===group.id));
 const count=Object.values(project.karaoke.lineGroups).filter(id=>removed.some(group=>group.id===id)).length;
 const update=(key:string,patch:Partial<typeof rows[number]>)=>setRows(rows.map(row=>row.key===key?{...row,...patch}:row));
 return <SettingsDialog title="分组管理" close={close}>
 <table className={styles.groupTable}><thead><tr><th>ID</th><th>名称</th><th aria-label="操作"/></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}>
 <td><input aria-label={`分组 ${index+1} ID`} aria-invalid={problem?.startsWith(`第 ${index+1} 组`)||false} aria-describedby={problem?.startsWith(`第 ${index+1} 组`)?'group-id-error':undefined} value={row.id} onChange={event=>update(row.key,{id:event.target.value})}/>{problem?.startsWith(`第 ${index+1} 组`)&&<small id="group-id-error" role="alert">{problem}</small>}</td>
 <td><input aria-label={`分组 ${index+1} 名称`} value={row.name} onChange={event=>update(row.key,{name:event.target.value})}/></td>
 <td>{([-1,1] as const).map(direction=><IconButton key={direction} icon={direction<0?'up':'down'} label={`${direction<0?'上移':'下移'}分组 ${index+1}`} disabled={index+direction<0||index+direction>=rows.length} onClick={()=>{const next=[...rows];[next[index],next[index+direction]]=[next[index+direction],next[index]];setRows(next);}}/>)}<IconButton icon="trash" label={`删除分组 ${index+1}`} data-role="danger" onClick={()=>setRows(rows.filter(item=>item.key!==row.key))}/></td>
 </tr>)}</tbody></table>
 <IconButton icon="add" label="新增分组" onClick={()=>setRows([...rows,{id:nextGroupId([...project.karaoke.groups,...groups]),name:'新分组',key:crypto.randomUUID(),originalId:''}])}/>
 {count>0&&<p>应用后将有 {count} 行未选择分组。</p>}{error&&<p role="alert">{error}</p>}
 <button data-role="primary" disabled={!!problem} onClick={()=>{if(apply({kind:'groups',groups,renames}))close();}}>应用分组</button>
 </SettingsDialog>;
}

function KaraokeExport({project,title,apply,close,viewIssues}:{project:ProjectDocument;title:string;apply:(c:KaraokeCommand)=>boolean;close:()=>void;viewIssues:(issues:OutputIssue[])=>void}) {
 const result=useMemo(()=>prepareNicokara(project,title),[project,title]);const [error,setError]=useState('');
 return <SettingsDialog title="导出 Nicokara" close={close}>{karaokeOutputs(project).map(output=><label className={styles.output} key={output.id}><input type="checkbox" checked={project.karaoke.outputs.includes(output.id)} onChange={e=>apply({kind:'outputs',outputs:e.target.checked?[...project.karaoke.outputs,output.id]:project.karaoke.outputs.filter(id=>id!==output.id)})}/>{output.label}</label>)}
 <p role="status">所选文件：{result.files.length} 个有内容，{result.issues.length} 项阻塞</p>{result.issues.length>0&&<p>{result.issues[0].message}</p>}{result.omitted.length>0&&<p>省略 {result.omitted.length} 个空输出</p>}
 <button data-role="secondary" onClick={()=>viewIssues(result.issues)}>查看校验</button><button data-role="primary" onClick={()=>{try{downloadKaraoke(nicokaraZip(project,title),`${safeFilename(title)}-nicokara.zip`,'application/zip');setError('');}catch(e){setError((e as Error).message);}}}>下载 ZIP</button>{error&&<p role="alert">{error}</p>}</SettingsDialog>;
}
