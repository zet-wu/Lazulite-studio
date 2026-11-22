import {useEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Tooltip} from '../shared/Tooltip';
import {Disclosure} from '../shared/Disclosure';
import {Select} from '../shared/Select';
import {Icon} from '../shared/Icon';
import {useMessageText} from '../shared/useMessageText';
import {errorMessage} from '../domain/messages';
import {formatMessage} from '../i18n';
import type {ProjectDocument,ProjectCommand} from '../domain/project-document';
import type {ProjectEditing} from '../domain/project-editing';
import type {LyricDocument} from '../domain/lyric-document';
import type {AmllRule} from '../domain/amll-compatibility';
import type {LyricFormat,ValidationFilter} from '../adapters/lyric-formats';
import {downloadFormats,prepareLyricDownload,defaultOutputProject,type DownloadFormat} from '../adapters/lyric-output';
import {safeFilename,zipFiles} from '../adapters/karaoke-output';
import {describeSelectedOutput} from '../adapters/format-description';
import {outputIssueKey,type OutputIssue} from '../adapters/output-validation';
import {audioRangeIssues} from '../adapters/audio-validation';
import {useProjectEditing} from './editor/ProjectEditingContext';
import {usePreference} from './editor/use-preference';
import {useAutomaticValidation,type ValidationTab} from './useAutomaticValidation';
import {OutputIssues} from './OutputIssues';
import {OutputSelection,type OutputSelectionHandle} from './OutputSelection';
import {AmllPanel} from './AmllPanel';
import {MusicPackaging} from './MusicPackaging';
import {SingerMarkersDialog} from './SingerMarkersDialog';
import {SugSingersDialog} from './SugSingersDialog';
import {downloadKaraoke} from './KaraokeTools';
import styles from './acquisition.module.css';
type Props={audioDurationMs?:number;downloadFormat?:DownloadFormat;onDownloadFormat?:(format:DownloadFormat)=>void;focusOutputId?:string;validationFilter?:ValidationFilter;onValidationFilter?:(filter:ValidationFilter)=>void;validationTab?:ValidationTab;onValidationTab?:(tab:ValidationTab)=>void;focusRule?:AmllRule;onRuleLocated?:()=>void;project?:ProjectDocument;applyProject?:(command:ProjectCommand)=>void;title?:string;document:LyricDocument;dirty?:boolean;onExportFormat?:(format:LyricFormat,content:string)=>void;saveForPackaging?:()=>Promise<{revision:string;document:LyricDocument;editing?:ProjectEditing}|undefined>;projectId?:string;sourceAssetId?:string;locateIssue:(issue:OutputIssue)=>void;externalIssues?:OutputIssue[]};
export function PackagingPanel(props:Props){
 const {t}=useTranslation(),editing=useProjectEditing();
 const title=props.title??t('workspace.defaultName');
 const project=useMemo(()=>props.project??defaultOutputProject(props.document,editing),[props.project,props.document,editing]);
 const [savedFormat,setSavedFormat]=usePreference<DownloadFormat>(`studio:download:${props.projectId?`project:${props.projectId}`:`local:${props.title}`}`,'ttml',(v):v is DownloadFormat=>downloadFormats.some(([id])=>id===v));
 const format=props.downloadFormat??savedFormat;
 const setFormat=(value:DownloadFormat)=>{setSavedFormat(value);props.onDownloadFormat?.(value);setOutputTab('lyrics');};
 const [localTab,setLocalTab]=useState<ValidationTab>('lyrics'),[outputTab,setOutputTab]=useState<'lyrics'|'music'>('lyrics');
 const tab=props.validationTab??localTab;
 const choose=(value:ValidationTab)=>{setLocalTab(value);props.onValidationTab?.(value);};
 const [all,setAll]=useState(false),[allResults,setAllResults]=useState<{project:typeof project;issues:OutputIssue[]}|null>(null);
 const prepared=useMemo(()=>prepareLyricDownload(project,format,title),[project,format,title]);
 useEffect(()=>{
  if(!all||tab!=='lyrics')return;
  let cancelled=false;
  void(async()=>{
   const issues:OutputIssue[]=[];
   for(const [target] of downloadFormats){await new Promise<void>(resolve=>setTimeout(resolve,0));if(cancelled)return;issues.push(...prepareLyricDownload(project,target,title).issues);}
   const combined=new Map<string,OutputIssue>();
   for(const issue of issues){const key=outputIssueKey(issue),previous=combined.get(key);combined.set(key,{...(previous??issue),formats:[...new Set([...(previous?.formats??[]),...(issue.formats??[])])]});}
   if(!cancelled)setAllResults({project,issues:[...combined.values()]});
  })();
  return()=>{cancelled=true;};
 },[all,tab,project,title]);
 // AMLL examines the complete semantic document independently of file content selection.
 const {result:amll,current:amllCurrent}=useAutomaticValidation(props.document,editing,props.projectId,'amll');
 const [attempted,setAttempted]=useState(false);
 const [message,setMessage]=useMessageText(''),[musicBlocking,setMusicBlocking]=useState<OutputIssue[]>([]),[dialog,setDialog]=useState<'singers'|'sug-singers'|null>(null);
 const selection=useRef<OutputSelectionHandle>(null),validationPane=useRef<HTMLElement>(null);
 useEffect(()=>{setMessage('');setAttempted(false);},[project,format]);
 useEffect(()=>{validationPane.current?.scrollTo?.(0,0);},[tab]);
 const apply=(command:ProjectCommand)=>{try{props.applyProject?.(command);setMessage('');return true;}catch(cause){setMessage(errorMessage(cause));return false;}};
 const locate=(issue:OutputIssue)=>{
  if(issue.karaokeSettings&&!issue.lineId){setOutputTab('lyrics');const id=issue.outputIds?.[0];const root=window.document.querySelector('[data-output-selection]');(id?Array.from(root?.querySelectorAll<HTMLInputElement>('[data-output-offset]')??[]).find(node=>node.dataset.outputOffset===id)??Array.from(root?.querySelectorAll<HTMLInputElement>('[data-output-id]')??[]).find(node=>node.dataset.outputId===id):root?.querySelector<HTMLInputElement>('input'))?.focus();return;}
  props.locateIssue(issue);
 };
 const download=()=>{
  const snapshot=selection.current?.commit()??(format==='ttml'||!props.project?project:null);if(!snapshot)return;
  const final=prepareLyricDownload(snapshot,format,title);
  if(final.issues.some(issue=>issue.severity!=='warning')){setAttempted(true);choose('lyrics');setAll(false);return;}
  if(format==='nicokara'||format==='sug')downloadKaraoke(zipFiles(final.archiveFiles),`${safeFilename(title)}-${format}.zip`,'application/zip');
  else if(final.files[0])downloadKaraoke(final.files[0].text,final.files[0].name,'text/plain;charset=utf-8');
 };
 const issues=outputTab==='music'&&musicBlocking.length?musicBlocking:props.document.lines.length===0?[]:all?(allResults?.project===project?allResults.issues:[]):prepared.issues;
 const ready=!all||allResults?.project===project;
 const audioIssues=!all&&format==='txt'?[]:audioRangeIssues(all?props.document:prepared.projection.document,all?props.project?.acoustics:undefined,props.sourceAssetId,props.audioDurationMs).filter(issue=>all||format!=='lrc'||issue.kind==='line');
 const label=downloadFormats.find(([id])=>id===format)![1];
 const tabs=(side:'validation'|'output',values:readonly string[],selected:string,change:(value:string)=>void,names:string[])=><div className={styles.validationTabs} role="tablist" aria-label={t(side==='validation'?'validation.type':'packaging.outputType')}>{values.map((value,index)=><button key={value} id={`${side}-tab-${value}`} data-role="secondary" role="tab" aria-selected={selected===value} aria-controls={`${side}-panel-${value}`} tabIndex={selected===value?0:-1} onClick={()=>change(value)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?values[0]:event.key==='End'?values.at(-1)!:values[(index+1)%values.length];change(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${side}-tab-${next}`)?.focus();}}>{names[index]}</button>)}</div>;
 return <div className={`${styles.page} ${styles.packagingPage}`}>
 <section ref={validationPane} className={styles.pane}>
 {tabs('validation',['lyrics','amll'],tab,value=>choose(value as ValidationTab),[t('validation.lyrics'),t('validation.amll')])}
 <div role="tabpanel" id={`validation-panel-${tab}`} aria-labelledby={`validation-tab-${tab}`} aria-busy={tab==='lyrics'?!ready:!amllCurrent}>
 {tab==='lyrics'?<><div className={styles.downloadRow}><label>{t('validation.formats')}<Select aria-label={t('validation.formatFilter')} value={all?'all':'current'} onChange={event=>setAll(event.target.value==='all')}><option value="current">{t('validation.currentOutput',{format:t(label,{defaultValue:label})})}</option><option value="all">{t('validation.allFormats')}</option></Select></label></div>
 {!ready&&<p role="status">{t('validation.updating')}</p>}
 <OutputIssues document={props.document} issues={[...issues,...audioIssues]} highlighted={outputTab==='music'&&musicBlocking.length?musicBlocking:attempted&&!all?prepared.issues:[]} locate={locate}/>
 {ready&&issues.length===0&&<p>{t(props.document.lines.length===0?'validation.noLyrics':all?'validation.clean':'validation.noBlocking')}</p>}</>:
 <>{!amllCurrent&&<p role="status">{t('validation.updating')}</p>}{amll?.error&&<p role="alert">{formatMessage(amll.error)}</p>}{props.project&&props.applyProject&&amll?.amll&&<AmllPanel project={props.project} results={amll.amll} current={amllCurrent} apply={props.applyProject} locate={locate} focusRule={props.focusRule} onRuleLocated={props.onRuleLocated}/>}</>}
 </div></section>
 <section className={styles.pane}>
 {tabs('output',['lyrics','music'],outputTab,value=>setOutputTab(value as 'lyrics'|'music'),[t('packaging.lyricsExport'),t('packaging.musicEmbed')])}
 <div role="tabpanel" id="output-panel-lyrics" aria-labelledby="output-tab-lyrics" hidden={outputTab!=='lyrics'}>
 <div className={styles.downloadRow}><label>{t('packaging.exportFormat')}<Select aria-label={t('packaging.exportFormat')} value={format} onChange={event=>setFormat(event.target.value as DownloadFormat)}>{downloadFormats.map(([id,name])=><option key={id} value={id}>{t(name,{defaultValue:name})}</option>)}</Select></label><button data-role="primary" onClick={download}>{t('packaging.exportNamed',{format:t(label,{defaultValue:label})})}</button></div>
 <Disclosure title={t('packaging.comparison')}>{()=> <table className={styles.formatComparison} aria-label={t('packaging.selectedComparison')}><thead><tr><th scope="col">{t('packaging.element')}</th><th scope="col">{t('packaging.result')}</th></tr></thead><tbody>{describeSelectedOutput(project,format,prepared.projection).map((row,index)=><tr key={row.element}><th scope="row">{t(row.element)}</th><td><Tooltip content={formatMessage(row.detail)} id={`format-detail-${index}`}><span className={styles.formatDetail} tabIndex={0} aria-describedby={`format-detail-${index}`}>{row.status==='partial'?t(row.result):<span role="img" aria-label={t(row.result)}><Icon name={row.status==='preserved'?'check':'close'}/></span>}</span></Tooltip></td></tr>)}</tbody></table>}</Disclosure>
 {props.project&&props.applyProject&&<OutputSelection ref={selection} project={props.project} format={format} apply={apply} focusOutputId={props.focusOutputId}/>}
 {format==='ttml'&&<p className={styles.hint}>{t('packaging.ttmlAll')}</p>}
 {(format==='nicokara'||format==='sug')&&<button data-role="secondary" onClick={()=>setDialog(format==='sug'?'sug-singers':'singers')}>{t(format==='sug'?'karaoke.sugSingers':'karaoke.singerMarkers')}</button>}
 {(format==='nicokara'||format==='sug')&&prepared.files.length>0&&<p role="status">{t('packaging.multiFileSummary',{count:prepared.files.length})}</p>}
 {prepared.issues.some(issue=>issue.severity!=='warning')&&<p role="status">{t('packaging.blockingHint',{count:prepared.issues.filter(issue=>issue.severity!=='warning').length})}</p>}
 {message&&<p role="alert">{message}</p>}
 </div>
 <div role="tabpanel" id="output-panel-music" aria-labelledby="output-tab-music" hidden={outputTab!=='music'}>
 {props.projectId&&props.sourceAssetId&&props.saveForPackaging?<MusicPackaging key={props.projectId} onIssues={next=>{setMusicBlocking(next);if(next.length){choose('lyrics');setAll(false);}}} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging}/>:<p>{t('packaging.uploadHelp')}</p>}
 </div>
 {dialog&&props.project&&<>{dialog==='sug-singers'?<SugSingersDialog error={message} project={props.project} close={()=>setDialog(null)} apply={command=>apply({type:'karaoke',command})}/>:<SingerMarkersDialog error={message} project={props.project} close={()=>setDialog(null)} apply={command=>apply({type:'karaoke',command})}/>}</>}
 </section></div>;
}
