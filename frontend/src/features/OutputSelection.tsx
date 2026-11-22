import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {ProjectCommand,ProjectDocument} from '../domain/project-document';
import {outputId} from '../domain/karaoke';
import type {DownloadFormat,OutputProject} from '../adapters/lyric-output';
import {karaokeOutputs} from '../adapters/karaoke-output';
import {Tooltip} from '../shared/Tooltip';
import {karaokeOutputLabel} from './output-messages';
import styles from './karaoke.module.css';
import panel from './acquisition.module.css';
export type OutputSelectionHandle={commit:()=>OutputProject|null};
export const OutputSelection=forwardRef<OutputSelectionHandle,{project:ProjectDocument;format:DownloadFormat;focusOutputId?:string;apply:(command:ProjectCommand)=>boolean}>(function OutputSelection({project,format,apply,focusOutputId},ref){
 const {t}=useTranslation();
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[invalid,setInvalid]=useState<string[]>([]);
 const inputs=useRef(new Map<string,HTMLInputElement>());
 const multiple=format==='sug'||format==='nicokara';
 const singleFile=!multiple&&format!=='ttml';
 const valid=(value:string)=>/^[+-]?\d+$/.test(value)&&Number.isSafeInteger(Number(value));
 const commit=(ids:string[])=>{
  const bad=ids.filter(id=>drafts[id]!==undefined&&!valid(drafts[id]));setInvalid(previous=>[...previous.filter(id=>!ids.includes(id)),...bad]);
  if(bad.length){inputs.current.get(bad[0])?.focus();return null;}
  const offsets=Object.fromEntries(ids.filter(id=>drafts[id]!==undefined).map(id=>[id,Number(drafts[id])]));
  if(Object.keys(offsets).length&&!apply({type:'karaoke',command:{kind:'offsets',offsets}}))return null;
  setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!ids.includes(id))));
  return {...project,karaoke:{...project.karaoke,offsets:{...project.karaoke.offsets,...offsets}}};
 };
 useImperativeHandle(ref,()=>({commit:()=>multiple?commit(project.karaoke.outputs):project}));
 useEffect(()=>{if(focusOutputId)inputs.current.get(focusOutputId)?.focus();},[focusOutputId,format]);
 const outputs=karaokeOutputs(project);
 const selectedOutputs=project.karaoke.outputs;
 const mergeSingleFile=singleFile&&selectedOutputs.length>1;
 const bracketBackground=['txt','lrc','elrc','eslrc','qrc','yrc'].includes(format)&&project.lyrics.lines.some(line=>{
  if(!line.backgroundOf)return false;
  const group=project.karaoke.lineGroups[line.id];
  if(selectedOutputs.includes(outputId(group)))return true;
  return project.lyrics.translationTracks.some(tr=>selectedOutputs.includes(outputId(group,'translation',tr.id))&&tr.contents.some(c=>c.lineId===line.id))
   ||project.lyrics.romanizationTracks.some(tr=>selectedOutputs.includes(outputId(group,'romanization',tr.id))&&tr.contents.some(c=>c.lineId===line.id));
 });
 const ruleHints=[mergeSingleFile?t('packaging.mergeSingleFile'):'',bracketBackground?t('packaging.bracketBackground'):''].filter(Boolean);
 return <div hidden={format==='ttml'} data-output-selection>
 <h3>{t('packaging.content')}</h3>
 {project.karaoke.groups.map(group=><div role="group" aria-labelledby={`output-group-${group.id}`} className={panel.outputGroup} key={group.id}>
  <div className={panel.outputGroupHeader}>
   <span id={`output-group-${group.id}`} className={panel.outputGroupTitle}>{group.name}</span>
   {multiple&&<span className={panel.outputGroupTitle} aria-hidden="true">{t('packaging.globalOffset')}</span>}
  </div>
  {outputs.filter(output=>output.groupId===group.id).map(output=>{
  const selected=selectedOutputs.includes(output.id);
  const track=output.kind==='translation'?project.lyrics.translationTracks.find(track=>track.id===output.trackId):undefined;
  const label=karaokeOutputLabel(output,project)+(track?` · ${t('translation.'+track.purpose)}`:'');
  const isInvalid=invalid.includes(output.id);
  const tipId=`offset-tip-${output.id}`;
  return <div className={panel.contentRow} key={output.id}>
   <label className={styles.output}><input type="checkbox" data-output-id={output.id} checked={selected} onChange={event=>apply({type:'karaoke',command:{kind:'outputs',outputs:event.target.checked?[...selectedOutputs,output.id]:selectedOutputs.filter(id=>id!==output.id)}})}/>{label}</label>
   {multiple&&<Tooltip content={t('packaging.offsetDirection')} id={tipId} className={styles.offsetField} data-invalid={isInvalid||undefined} data-disabled={!selected||undefined}>
    <input className={styles.offset} data-output-offset={output.id} inputMode="numeric" name={`output-offset-${output.id}`} autoComplete="off" spellCheck={false} aria-label={`${label} ${format==='sug'?t('karaoke.offset'):'@Offset'}`} aria-describedby={isInvalid?'offset-error':tipId} aria-invalid={isInvalid} disabled={!selected} value={drafts[output.id]??String(project.karaoke.offsets[output.id]??0)} ref={node=>{if(node)inputs.current.set(output.id,node);else inputs.current.delete(output.id);}}
     onChange={event=>setDrafts(previous=>({...previous,[output.id]:event.target.value}))} onBlur={()=>{if(selected)commit([output.id]);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit([output.id]);}}}/>
    <span className={styles.offsetUnit} aria-hidden="true">ms</span>
   </Tooltip>}
  </div>;
 })}</div>)}
 {ruleHints.length>0&&<p className={panel.hint} data-output-rule-hint>{ruleHints.join(' ')}</p>}
 {invalid.length>0&&multiple&&<p id="offset-error" role="alert">{t('output.integerOffset')}</p>}
 </div>;
});
