import { Tooltip } from '../shared/Tooltip';
import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage } from '../domain/messages';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
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
export function PackagingPanel(props: { audioDurationMs?: number; karaokeExportSource?:'nicokara'|'sug'; validationFilter?:ValidationFilter; onValidationFilter?:(filter:ValidationFilter)=>void; resumeKaraoke?:()=>void; validationTab?: ValidationTab; onValidationTab?: (tab:ValidationTab)=>void; focusRule?: AmllRule; onRuleLocated?:()=>void; project?: ProjectDocument; applyProject?: (command:ProjectCommand)=>void; title?: string; document: LyricDocument; dirty?: boolean; onExportFormat?: (format: LyricFormat, content: string) => void; saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined>; projectId?: string; sourceAssetId?: string; locateIssue: (issue: OutputIssue) => void; externalIssues?: OutputIssue[] }) {
  useTranslation();
 const [localFilter,setLocalFilter]=useState<ValidationFilter>('all');
 const filter=props.validationFilter??localFilter;
 const setFilter=(value:ValidationFilter)=>{setLocalFilter(value);props.onValidationFilter?.(value);};
 const editing = useProjectEditing();
 const [localTab,setLocalTab] = useState<ValidationTab>('lyrics');
 const tab=props.validationTab??localTab;
 const needsNicokara=props.document.lines.length > 0 && tab==='lyrics'&&(filter==='all'||filter==='nicokara');
 const needsSug=props.document.lines.length > 0 && tab==='lyrics'&&(filter==='all'||filter==='sug');
 const sug=useMemo(()=>needsSug&&props.project?prepareSug(props.project,props.title??t('workspace.defaultName')):null,[needsSug,props.project,props.title]);
 const nicokara=useMemo(()=>needsNicokara&&props.project?prepareNicokara(props.project,props.title??t('workspace.defaultName')):null,[needsNicokara,props.project,props.title]);
 const validationPane=useRef<HTMLElement>(null);
 useEffect(()=>{if(validationPane.current)validationPane.current.scrollTop=0;},[tab]);
 const choose=(next:ValidationTab)=>{setLocalTab(next);props.onValidationTab?.(next);};
 const {result,current}=useAutomaticValidation(props.document,editing,props.project?.amll,props.projectId,tab,props.project?.acoustics,props.sourceAssetId,props.audioDurationMs);
 const combined=new Map<string,OutputIssue>();
 for(const issue of [...(result?.issues??[]),...(nicokara?.issues??[]),...(sug?.issues??[])]) {
   const key=outputIssueKey(issue)+issue.message, old=combined.get(key);
   if(old?.severity==='error'&&issue.severity==='warning')continue;
   combined.set(key,old&&old.severity===issue.severity?{...old,formats:[...new Set([...(old.formats??[]),...(issue.formats??[])])],outputIds:[...new Set([...(old.outputIds??[]),...(issue.outputIds??[])])]}:issue);
 }
 const [musicBlocking,setMusicBlocking]=useState<OutputIssue[]>([]);
 const [blocking,setBlocking] = useState<OutputIssue[]>([]), [message,setMessage] = useMessageText('');
 const [format, setFormat] = usePreference<LyricFormat>(`studio:download:${props.projectId ? `project:${props.projectId}` : `local:${props.title}`}`, 'ttml', (v): v is LyricFormat => exportFormats.some(([id])=>id===v));
 useEffect(()=>{setBlocking([]);setMessage('');},[editing,props.document,props.projectId,props.project?.karaoke,format]);

 const visibleIssues=filter==='sug'?[...(sug?.issues??[]),...(result?.issues??[]).filter(i=>i.code==='audio-range')]:filter==='nicokara'?[...(nicokara?.issues??[]),...(result?.issues??[]).filter(i=>i.code==='audio-range')]:[...combined.values()].filter(issue=>filter==='all'||issue.code==='audio-range'||issue.severity==='error'&&issue.formats?.includes(filter.toUpperCase()));
 return <div className={`${styles.page} ${styles.packagingPage}`}><section ref={validationPane} className={styles.pane}>
 <div className={styles.validationTabs} role="tablist" aria-label={t('validation.type')}>{(['lyrics','amll'] as const).map((value,index)=><button key={value} id={`validation-tab-${value}`} data-role="secondary" role="tab" aria-selected={tab===value} aria-controls={`validation-panel-${value}`} tabIndex={tab===value?0:-1}
 onClick={()=>choose(value)} onKeyDown={event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();const next=event.key==='Home'?'lyrics':event.key==='End'?'amll':index===0?'amll':'lyrics';
   choose(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#validation-tab-${next}`)?.focus();
 }}>{value==='lyrics'?t('validation.lyrics'):t('validation.amll')}</button>)}</div>
 <div role="tabpanel" key={tab} id={`validation-panel-${tab}`} aria-labelledby={`validation-tab-${tab}`} aria-busy={!current}>
 {!current&&<p role="status">{t('validation.updating')}</p>}
 {current&&result?.error&&<p role="alert">{t('validation.failed')}{formatMessage(result.error)}</p>}
 {tab==='lyrics'?<><div className={styles.downloadRow}><label>{t('validation.formats')}<Select aria-label={t('validation.formatFilter')} value={filter} onChange={e=>setFilter(e.target.value as ValidationFilter)}><option value="all">{t('validation.allFormats')}</option>{exportFormats.map(([id,label])=><option key={id} value={id}>{t(label,{defaultValue:label})}</option>)}<option value="sug">{t('validation.sugSelection')}</option><option value="nicokara">{t('validation.nicokaraSelection')}</option></Select></label>{props.resumeKaraoke&&<button data-role="secondary" onClick={props.resumeKaraoke}>{t('packaging.returnExport',{format:props.karaokeExportSource==='sug'?'SUG':'NicoKara'})}</button>}</div><OutputIssues document={props.document} issues={current&&!result?.error?visibleIssues:[]} highlighted={[]} locate={props.locateIssue}/>{current&&!result?.error&&(props.document.lines.length===0||visibleIssues.length===0)&&<p>{props.document.lines.length===0?t('validation.noLyrics'):filter==='all'?t('validation.clean'):t('validation.noBlocking')}</p>}</>:
 props.project&&props.applyProject&&result?.amll&&<AmllPanel project={props.project} results={result.amll} current={current} apply={props.applyProject} locate={props.locateIssue} focusRule={props.focusRule} onRuleLocated={props.onRuleLocated}/>}
 </div>
 </section><section className={styles.pane}><h2>{t('packaging.lyricsDownload')}</h2><div className={styles.downloadRow}>
 <label>{t('packaging.exportFormat')}<Select aria-label={t('packaging.exportFormat')} value={format} onChange={e => setFormat(e.target.value as LyricFormat)}>{exportFormats.map(([id,label]) => <option key={id} value={id}>{t(label,{defaultValue:label})}</option>)}</Select></label><button data-role="secondary" onClick={() => {
 setBlocking([]); setMessage('');
 try { const content=exportLyricFile(props.document,format,editing); props.onExportFormat?.(format,content); }
 catch(e) { setFilter(format as ValidationFilter); choose('lyrics'); if(e instanceof DocumentOutputError)setBlocking(uniqueOutputIssues(e.issues)); else setMessage(errorMessage(e)); }
 }}>{t('packaging.downloadLyrics')}</button></div><Disclosure title={t('packaging.comparison')}>{() => <table className={styles.formatComparison} aria-label={t('packaging.selectedComparison')}><thead><tr><th scope="col">{t('packaging.element')}</th><th scope="col">{t('packaging.result')}</th></tr></thead><tbody>{describeLyricFormat(props.document, format as Exclude<LyricFormat,'krc'>).map((row,index) => <tr key={row.element}><th scope="row">{t(row.element)}</th><td><Tooltip content={formatMessage(row.detail)} id={`format-detail-${index}`}><span className={styles.formatDetail} tabIndex={0} aria-describedby={`format-detail-${index}`}>{row.status === 'partial' ? <span>{t(row.result)}</span> : <span role="img" aria-label={t(row.result)}><Icon name={row.status === 'preserved' ? 'check' : 'close'}/></span>}</span></Tooltip></td></tr>)}</tbody></table>}</Disclosure>{message && <p role="alert">{message}</p>}
 <OutputIssues document={props.document} issues={blocking} highlighted={blocking} locate={props.locateIssue}/><h2>{t('packaging.musicFile')}</h2><OutputIssues document={props.document} issues={musicBlocking} highlighted={musicBlocking} locate={props.locateIssue}/>{props.projectId && props.sourceAssetId && props.saveForPackaging ? <MusicPackaging dirty={props.dirty} key={props.projectId} onIssues={setMusicBlocking} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging} /> : <p>{t('packaging.uploadHelp')}</p>}</section></div>;
}

const t=i18n.t.bind(i18n);
