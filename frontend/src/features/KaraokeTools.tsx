import { SingerMarkersDialog } from './SingerMarkersDialog';
import { useMemo, useState, type ReactNode } from 'react';
import { anchorKey, anchorRange, cueProblem, type CueAnchor, type KaraokeCommand, type KaraokeCue } from '../domain/karaoke';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { karaokeOutputs, nicokaraZip, prepareNicokara, safeFilename } from '../adapters/nicokara';
import { SettingsDialog } from './editor/SettingsDialog';
import { DraftInput, TimePair } from './editor/EditorFields';
import { useEditorSelection } from './editor/SelectionContext';
import { Select } from '../shared/Select';
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
  return <><h3>导唱</h3><label>文字 <DraftInput value={cue.text} label="导唱文字" onCommit={text=>apply({kind:'cue',id:cue.id,text,beginMs:cue.beginMs,endMs:cue.endMs})}/></label>
    <TimePair begin={cue.beginMs} end={cue.endMs} label="导唱" onCommit={(beginMs,endMs)=>{if(beginMs===null||endMs===null)throw new Error('导唱需要完整双端');apply({kind:'cue',id:cue.id,text:cue.text,beginMs,endMs});}}/>
    {problem&&<p role="alert">{problem}</p>}<button data-role="danger" onClick={()=>apply({kind:'remove',id:cue.id})}>删除导唱</button></>;
}
export function KaraokeTools({project,apply,title,exportOpen,setExportOpen,viewIssues}: {project:ProjectDocument;apply:(command:ProjectCommand)=>void;title:string;exportOpen:boolean;setExportOpen:(open:boolean)=>void;viewIssues:(issues:OutputIssue[])=>void}) {
 const [dialog,setDialog]=useState<'groups'|'defaults'|'auto'|'singers'|null>(null), [error,setError]=useState('');
 const command=(c:KaraokeCommand)=>{try{apply({type:'karaoke',command:c});setError('');return true;}catch(e){setError((e as Error).message);return false;}};
 return <><div className={styles.tools}><button data-role="secondary" onClick={()=>setDialog('groups')}>分组管理</button><button data-role="secondary" onClick={()=>setDialog('auto')}>自动插入导唱符</button><button data-role="secondary" onClick={()=>setDialog('defaults')}>默认导唱符</button><button data-role="primary" onClick={()=>setExportOpen(true)}>导出 Nicokara</button><button data-role="secondary" onClick={()=>setDialog('singers')}>歌手标记管理</button></div>
 {error&&!dialog&&<p role="alert">{error}</p>}
 {dialog==='singers'&&<SingerMarkersDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='auto'&&<AutoInsertDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='defaults'&&<DefaultsDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {dialog==='groups'&&<GroupsDialog error={error} project={project} close={()=>setDialog(null)} apply={command}/>}
 {exportOpen&&<KaraokeExport project={project} title={title} apply={command} close={()=>setExportOpen(false)} viewIssues={issues=>{setExportOpen(false);viewIssues(issues);}}/>}</>;
}
function DefaultsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [value,setValue]=useState(project.karaoke.defaults);
 return <SettingsDialog title="默认导唱符" close={close}>{error&&<p role="alert">{error}</p>}<div className={styles.defaults}><label htmlFor="cue-default-text">导唱文字</label><input id="cue-default-text" value={value.text} onChange={e=>setValue({...value,text:e.target.value})}/>
</div><p>默认文字只影响之后新增的导唱。</p><button data-role="primary" onClick={()=>{if(apply({kind:'settings',defaults:value}))close();}}>应用</button></SettingsDialog>;
}
function AutoInsertDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [groups,setGroups]=useState(project.karaoke.groups.map(group=>group.id));
 const [thresholds,setThresholds]=useState(Object.fromEntries((['beforeMs','wordMs','rubyMs'] as const).map(key=>[key,String(project.karaoke.defaults[key])])));
 const [inputError,setInputError]=useState('');
 return <SettingsDialog title="自动插入导唱符" close={close}>{(inputError||error)&&<p role="alert">{inputError||error}</p>}
 <fieldset><legend>目标输出分组</legend>{project.karaoke.groups.map(group=><label className={styles.output} key={group.id}><input type="checkbox" checked={groups.includes(group.id)} onChange={e=>setGroups(e.target.checked?[...groups,group.id]:groups.filter(id=>id!==group.id))}/>{group.name}</label>)}</fieldset>
 {([['beforeMs','行前阈值'],['wordMs','正文行内阈值'],['rubyMs','Ruby 内阈值']] as const).map(([key,label])=><Field key={key} label={`${label}（毫秒）`}><input aria-label={label} type="number" min={0} step={1} value={thresholds[key]} onChange={e=>setThresholds({...thresholds,[key]:e.target.value})}/></Field>)}
 <p>仅大于阈值时自动插入。</p><button data-role="primary" onClick={()=>{
 if(Object.values(thresholds).some(value=>!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))){setInputError('阈值须为非负整数');return;}
 if(apply({kind:'auto',groupIds:groups,thresholds:{beforeMs:Number(thresholds.beforeMs),wordMs:Number(thresholds.wordMs),rubyMs:Number(thresholds.rubyMs)}}))close();
 }}>插入</button></SettingsDialog>;
}
function Field({label,children}:{label:string;children:ReactNode}) {return <label>{label}{children}</label>;}
function GroupsDialog({project,close,apply,error}:{error:string;project:ProjectDocument;close:()=>void;apply:(c:KaraokeCommand)=>boolean}) {
 const [groups,setGroups]=useState(project.karaoke.groups),[moves,setMoves]=useState<Record<string,string>>({}),[main,setMain]=useState(project.karaoke.defaults.main),[background,setBackground]=useState(project.karaoke.defaults.background);
 const removed=project.karaoke.groups.filter(g=>!groups.some(group=>group.id===g.id));
 return <SettingsDialog title="分组管理" close={close}>{error&&<p role="alert">{error}</p>}<div className={styles.groups}>{groups.map((group,index)=><div className={styles.group} key={group.id}><input aria-label={`分组名称 ${group.id}`} value={group.name} onChange={e=>setGroups(groups.map(g=>g.id===group.id?{...g,name:e.target.value}:g))}/><small>{group.id}</small><button data-role="inline" disabled={!index} onClick={()=>{const next=[...groups];[next[index-1],next[index]]=[next[index],next[index-1]];setGroups(next);}}>上移</button><button data-role="inline" disabled={index===groups.length-1} onClick={()=>{const next=[...groups];[next[index+1],next[index]]=[next[index],next[index+1]];setGroups(next);}}>下移</button><button data-role="danger" disabled={groups.length===1} onClick={()=>{setGroups(groups.filter(g=>g.id!==group.id));if(main===group.id)setMain(null);if(background===group.id)setBackground(null);}}>删除</button></div>)}
 <button data-role="secondary" onClick={()=>setGroups([...groups,{id:crypto.randomUUID(),name:'新分组'}])}>新增分组</button>
 {removed.filter(g=>Object.values(project.karaoke.lineGroups).includes(g.id)).map(g=><label key={g.id}>{g.name} 的歌词迁往<Select value={moves[g.id]??''} onChange={e=>setMoves({...moves,[g.id]:e.target.value})}><option value="">请选择</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label>)}
 {([['新主行默认组',main,setMain],['新背景行默认组',background,setBackground]] as const).map(([label,value,set])=><label key={label}>{label}<Select value={value??''} onChange={e=>set(e.target.value||null)}><option value="">新行需手动分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label>)}
 <button data-role="primary" onClick={()=>{if(apply({kind:'groups',groups,moves,main,background}))close();}}>应用分组</button></div></SettingsDialog>;
}
function KaraokeExport({project,title,apply,close,viewIssues}:{project:ProjectDocument;title:string;apply:(c:KaraokeCommand)=>boolean;close:()=>void;viewIssues:(issues:OutputIssue[])=>void}) {
 const result=useMemo(()=>prepareNicokara(project,title),[project,title]);const [error,setError]=useState('');
 return <SettingsDialog title="导出 Nicokara" close={close}>{karaokeOutputs(project).map(output=><label className={styles.output} key={output.id}><input type="checkbox" checked={project.karaoke.outputs.includes(output.id)} onChange={e=>apply({kind:'outputs',outputs:e.target.checked?[...project.karaoke.outputs,output.id]:project.karaoke.outputs.filter(id=>id!==output.id)})}/>{output.label}</label>)}
 <p role="status">所选文件：{result.files.length} 个有内容，{result.issues.length} 项阻塞</p>{result.issues.length>0&&<p>{result.issues[0].message}</p>}{result.omitted.length>0&&<p>省略 {result.omitted.length} 个空输出</p>}
 <button data-role="secondary" onClick={()=>viewIssues(result.issues)}>查看校验</button><button data-role="primary" onClick={()=>{try{downloadKaraoke(nicokaraZip(project,title),`${safeFilename(title)}-nicokara.zip`,'application/zip');setError('');}catch(e){setError((e as Error).message);}}}>下载 ZIP</button>{error&&<p role="alert">{error}</p>}</SettingsDialog>;
}
