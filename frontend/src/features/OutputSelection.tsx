import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {ProjectCommand,ProjectDocument} from '../domain/project-document';
import type {DownloadFormat,OutputProject} from '../adapters/lyric-output';
import {karaokeOutputs} from '../adapters/karaoke-output';
import {karaokeOutputLabel} from './output-messages';
import styles from './karaoke.module.css';
import panel from './acquisition.module.css';
export type OutputSelectionHandle={commit:()=>OutputProject|null};
export const OutputSelection=forwardRef<OutputSelectionHandle,{project:ProjectDocument;format:DownloadFormat;focusOutputId?:string;apply:(command:ProjectCommand)=>boolean}>(function OutputSelection({project,format,apply,focusOutputId},ref){
 const {t}=useTranslation();
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[invalid,setInvalid]=useState<string[]>([]);
 const inputs=useRef(new Map<string,HTMLInputElement>());
 const multiple=format==='sug'||format==='nicokara';
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
 return <div hidden={format==='ttml'} data-output-selection>
 <h3>{t('packaging.content')}</h3>
 {multiple&&<p className={panel.hint} id="offset-help">{t('karaoke.offsetHelp')}</p>}
 {project.karaoke.groups.map(group=><fieldset className={panel.outputGroup} key={group.id}><legend>{group.name}</legend>{outputs.filter(output=>output.groupId===group.id).map(output=>{
  const selected=project.karaoke.outputs.includes(output.id);
  const track=output.kind==='translation'?project.lyrics.translationTracks.find(track=>track.id===output.trackId):undefined;
  const label=karaokeOutputLabel(output,project)+(track?` · ${t('translation.'+track.purpose)}`:'');
  return <div className={panel.contentRow} key={output.id}>
   <label className={styles.output}><input type="checkbox" data-output-id={output.id} checked={selected} onChange={event=>apply({type:'karaoke',command:{kind:'outputs',outputs:event.target.checked?[...project.karaoke.outputs,output.id]:project.karaoke.outputs.filter(id=>id!==output.id)}})}/>{label}</label>
   {multiple&&<input className={styles.offset} data-output-offset={output.id} inputMode="numeric" name={`output-offset-${output.id}`} autoComplete="off" spellCheck={false} aria-label={`${label} ${format==='sug'?t('karaoke.offset'):'@Offset'}`} aria-describedby={invalid.includes(output.id)?'offset-error':'offset-help'} aria-invalid={invalid.includes(output.id)} disabled={!selected} value={drafts[output.id]??String(project.karaoke.offsets[output.id]??0)} ref={node=>{if(node)inputs.current.set(output.id,node);else inputs.current.delete(output.id);}}
    onChange={event=>setDrafts(previous=>({...previous,[output.id]:event.target.value}))} onBlur={()=>{if(selected)commit([output.id]);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit([output.id]);}}}/>}
  </div>;
 })}</fieldset>)}
 {invalid.length>0&&multiple&&<p id="offset-error" role="alert">{t('karaoke.offsetInvalid')}</p>}
 </div>;
});
