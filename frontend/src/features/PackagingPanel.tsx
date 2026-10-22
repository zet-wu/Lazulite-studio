import { prepareSug } from '../adapters/sug';
import { prepareNicokara } from '../adapters/nicokara';
import { Disclosure } from '../shared/Disclosure';
import { AmllPanel } from './AmllPanel';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
import { Icon } from '../shared/Icon';
import { useProjectEditing } from './editor/ProjectEditingContext';
import type { ProjectEditing } from '../domain/project-editing';
import { describeLyricFormat } from '../adapters/format-description';
import { useAutomaticValidation, type ValidationTab } from './useAutomaticValidation';
import type { AmllRule } from '../domain/amll-compatibility';
import { Select } from '../shared/Select';
import { usePreference } from './editor/use-preference';
import { OutputIssues } from './OutputIssues';
import { uniqueOutputIssues, DocumentOutputError, outputIssueKey, type OutputIssue } from '../adapters/output-validation';
import { MusicPackaging } from './MusicPackaging';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exportLyricFile, exportFormats, type ValidationFilter, type LyricFormat } from '../adapters/lyric-formats';
import type { LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
export function PackagingPanel(props: { karaokeExportSource?:'nicokara'|'sug'; validationFilter?:ValidationFilter; onValidationFilter?:(filter:ValidationFilter)=>void; resumeKaraoke?:()=>void; validationTab?: ValidationTab; onValidationTab?: (tab:ValidationTab)=>void; focusRule?: AmllRule; onRuleLocated?:()=>void; project?: ProjectDocument; applyProject?: (command:ProjectCommand)=>void; title?: string; document: LyricDocument; dirty?: boolean; onExportFormat?: (format: LyricFormat, content: string) => void; saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined>; projectId?: string; sourceAssetId?: string; locateIssue: (issue: OutputIssue) => void; externalIssues?: OutputIssue[] }) {
 const [localFilter,setLocalFilter]=useState<ValidationFilter>('all');
 const filter=props.validationFilter??localFilter;
 const setFilter=(value:ValidationFilter)=>{setLocalFilter(value);props.onValidationFilter?.(value);};
 const editing = useProjectEditing();
 const [localTab,setLocalTab] = useState<ValidationTab>('lyrics');
 const tab=props.validationTab??localTab;
 const needsNicokara=tab==='lyrics'&&(filter==='all'||filter==='nicokara');
 const needsSug=tab==='lyrics'&&(filter==='all'||filter==='sug');
 const sug=useMemo(()=>needsSug&&props.project?prepareSug(props.project,props.title??'歌词项目'):null,[needsSug,props.project,props.title]);
 const nicokara=useMemo(()=>needsNicokara&&props.project?prepareNicokara(props.project,props.title??'歌词项目'):null,[needsNicokara,props.project,props.title]);
 const validationPane=useRef<HTMLElement>(null);
 useEffect(()=>{if(validationPane.current)validationPane.current.scrollTop=0;},[tab]);
 const choose=(next:ValidationTab)=>{setLocalTab(next);props.onValidationTab?.(next);};
 const {result,current}=useAutomaticValidation(props.document,editing,props.project?.amll,props.projectId,tab);
 const combined=new Map<string,OutputIssue>();
 for(const issue of [...(result?.issues??[]),...(nicokara?.issues??[]),...(sug?.issues??[])]) {
   const key=outputIssueKey(issue)+issue.message, old=combined.get(key);
   if(old?.severity==='error'&&issue.severity==='warning')continue;
   combined.set(key,old&&old.severity===issue.severity?{...old,formats:[...new Set([...(old.formats??[]),...(issue.formats??[])])],outputIds:[...new Set([...(old.outputIds??[]),...(issue.outputIds??[])])]}:issue);
 }
 const [musicBlocking,setMusicBlocking]=useState<OutputIssue[]>([]);
 const [blocking,setBlocking] = useState<OutputIssue[]>([]), [message,setMessage] = useState('');
 const [format, setFormat] = usePreference<LyricFormat>(`studio:download:${props.projectId ? `project:${props.projectId}` : `local:${props.title}`}`, 'ttml', (v): v is LyricFormat => exportFormats.some(([id])=>id===v));
 useEffect(()=>{setBlocking([]);setMessage('');},[editing,props.document,props.projectId,props.project?.karaoke,format]);

 const visibleIssues=filter==='sug'?sug?.issues??[]:filter==='nicokara'?nicokara?.issues??[]:[...combined.values()].filter(issue=>filter==='all'||issue.severity==='error'&&issue.formats?.includes(filter.toUpperCase()));
 return <div className={`${styles.page} ${styles.packagingPage}`}><section ref={validationPane} className={styles.pane}>
 <div className={styles.validationTabs} role="tablist" aria-label="校验类型">{(['lyrics','amll'] as const).map((value,index)=><button key={value} id={`validation-tab-${value}`} data-role="secondary" role="tab" aria-selected={tab===value} aria-controls={`validation-panel-${value}`} tabIndex={tab===value?0:-1}
 onClick={()=>choose(value)} onKeyDown={event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();const next=event.key==='Home'?'lyrics':event.key==='End'?'amll':index===0?'amll':'lyrics';
   choose(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#validation-tab-${next}`)?.focus();
 }}>{value==='lyrics'?'歌词校验':'AMLL 兼容校验'}</button>)}</div>
 <div role="tabpanel" key={tab} id={`validation-panel-${tab}`} aria-labelledby={`validation-tab-${tab}`} aria-busy={!current}>
 {!current&&<p role="status">正在更新校验</p>}
 {current&&result?.error&&<p role="alert">校验失败：{result.error}</p>}
 {tab==='lyrics'?<><div className={styles.downloadRow}><label>适用格式 <Select aria-label="校验格式筛选" value={filter} onChange={e=>setFilter(e.target.value as ValidationFilter)}><option value="all">全部歌词格式</option>{exportFormats.map(([id,label])=><option key={id} value={id}>{label}</option>)}<option value="sug">SUG · 当前所选文件</option><option value="nicokara">NicoKara · 当前所选文件</option></Select></label>{props.resumeKaraoke&&<button data-role="secondary" onClick={props.resumeKaraoke}>返回 {props.karaokeExportSource==='sug'?'SUG':'NicoKara'} 导出</button>}</div><OutputIssues document={props.document} issues={current&&!result?.error?visibleIssues:[]} highlighted={[]} locate={props.locateIssue}/>{current&&!result?.error&&visibleIssues.length===0&&<p>{filter==='all'?'当前检查未发现问题':'当前检查未发现阻塞此格式的问题'}</p>}</>:
 props.project&&props.applyProject&&result?.amll&&<AmllPanel project={props.project} results={result.amll} current={current} apply={props.applyProject} locate={props.locateIssue} focusRule={props.focusRule} onRuleLocated={props.onRuleLocated}/>}
 </div>
 </section><section className={styles.pane}><h2>歌词下载</h2><div className={styles.downloadRow}>
 <label>导出格式 <Select aria-label="导出格式" value={format} onChange={e => setFormat(e.target.value as LyricFormat)}>{exportFormats.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select></label><button data-role="secondary" onClick={() => {
 setBlocking([]); setMessage('');
 try { const content=exportLyricFile(props.document,format,editing); props.onExportFormat?.(format,content); }
 catch(e) { setFilter(format as ValidationFilter); choose('lyrics'); if(e instanceof DocumentOutputError)setBlocking(uniqueOutputIssues(e.issues)); else setMessage(e instanceof Error ? e.message : '导出失败'); }
 }}>下载歌词</button></div><Disclosure title="导出对照">{() => <table className={styles.formatComparison} aria-label="所选格式导出对照"><thead><tr><th scope="col">要素</th><th scope="col">导出结果</th></tr></thead><tbody>{describeLyricFormat(props.document, format as Exclude<LyricFormat,'krc'>).map((row,index) => <tr key={row.element}><th scope="row">{row.element}</th><td><span className={styles.formatDetail} tabIndex={0} aria-describedby={`format-detail-${index}`}>{row.status === 'partial' ? <span>{row.result}</span> : <span role="img" aria-label={row.result}><Icon name={row.status === 'preserved' ? 'check' : 'close'}/></span>}<span role="tooltip" id={`format-detail-${index}`}>{row.detail}</span></span></td></tr>)}</tbody></table>}</Disclosure>{message && <p role="alert">{message}</p>}
 <OutputIssues document={props.document} issues={blocking} highlighted={blocking} locate={props.locateIssue}/><h2>音乐文件</h2><OutputIssues document={props.document} issues={musicBlocking} highlighted={musicBlocking} locate={props.locateIssue}/>{props.projectId && props.sourceAssetId && props.saveForPackaging ? <MusicPackaging dirty={props.dirty} key={props.projectId} onIssues={setMusicBlocking} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging} /> : <p>上传音乐后可打包音乐文件；单独下载歌词无需音乐。</p>}</section></div>;
}
