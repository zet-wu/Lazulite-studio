import { errorMessage, message, type Message } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { assertChangedTimes } from '../domain/time-boundaries';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useKaraokeProject } from './KaraokeContext';
import { useEditorSelection } from './editor/SelectionContext';
import { cueProblem, type KaraokeCue } from '../domain/karaoke';
import { packIntervals } from '../domain/pack-intervals';
import { snapTimelineTime, timelineDelta } from '../domain/timeline-editing';
import styles from './karaoke.module.css';
type Drag = { cue: KaraokeCue; side:'move'|'beginMs'|'endMs'; x:number; width:number; beginMs:number; endMs:number; error:string | Message; pointer:number; element:HTMLElement };
export function KaraokeTrack({startMs,endMs,snap,bpm,anchors,onError,durationMs=null}:{durationMs?:number|null;startMs:number;endMs:number;snap:boolean;bpm:number;anchors:number[];onError:(message:string | Message)=>void}) {
  useTranslation();
 const context=useKaraokeProject(),shared=useEditorSelection()!,lane=useRef<HTMLDivElement>(null),[drag,setDrag]=useState<Drag|null>(null),current=useRef<Drag|null>(null);
 const cancel=()=>{const value=current.current;current.current=null;setDrag(null);if(value?.element.hasPointerCapture(value.pointer))value.element.releasePointerCapture(value.pointer);};
 useEffect(()=>{cancel();},[context?.project,startMs,endMs,durationMs]);
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);cancel();};},[]);
 if(!context)return null;
 const {project,apply,locked}=context;
 const cues=project.karaoke.cues.filter(c=>c.endMs>=startMs&&c.beginMs<=endMs),layout=packIntervals(cues.map(c=>({...c,key:c.id}))),span=Math.max(1,endMs-startMs);
 const begin=(e:PointerEvent<HTMLElement>,cue:KaraokeCue,side:Drag['side'])=>{
  if(e.button!==0||locked)return;e.preventDefault();e.stopPropagation();shared.selectCue(cue.id,cue.anchor.lineId);
  e.currentTarget.setPointerCapture(e.pointerId);
  current.current={cue,side,x:e.clientX,width:lane.current!.clientWidth,beginMs:cue.beginMs,endMs:cue.endMs,error:'',pointer:e.pointerId,element:e.currentTarget};setDrag(current.current);
 };
 const move=(e:PointerEvent<HTMLElement>)=>{
  const value=current.current;if(!value)return;
  let time=(value.side==='endMs'?value.cue.endMs:value.cue.beginMs)+timelineDelta(e.clientX-value.x,value.width,span);
  const options=[...anchors,...project.karaoke.cues.filter(c=>c.id!==value.cue.id).flatMap(c=>[c.beginMs,c.endMs])];
  if(bpm>0)for(let t=Math.ceil(startMs/(60000/bpm))*60000/bpm;t<=endMs&&options.length<20000;t+=60000/bpm)options.push(Math.round(t));
  time=snapTimelineTime(time,options,span,value.width,snap);
  const beginMs=value.side==='endMs'?value.cue.beginMs:time,end=value.side==='move'?time+value.cue.endMs-value.cue.beginMs:value.side==='endMs'?time:value.cue.endMs;
  let error: string | Message=cueProblem(project.lyrics,project.karaoke,{...value.cue,beginMs,endMs:end}) ? message(cueProblem(project.lyrics,project.karaoke,{...value.cue,beginMs,endMs:end})!) : '';
  try { assertChangedTimes([{...value.cue,kind:'cue',lineId:value.cue.anchor.lineId}],[{...value.cue,beginMs,endMs:end,kind:'cue',lineId:value.cue.anchor.lineId}],durationMs); } catch(cause) { error=errorMessage(cause); }
  current.current={...value,beginMs,endMs:end,error};setDrag(current.current);onError(error);
 };
 const finish=()=>{const value=current.current;cancel();if(!value||value.error)return;try{apply({type:'karaoke',command:{kind:'cue',id:value.cue.id,text:value.cue.text,beginMs:value.beginMs,endMs:value.endMs}});}catch(e){onError(errorMessage(e));}};
 return <div className={styles.track} aria-label={t('karaoke.guideTrack')}><strong>{t('karaoke.cue')}</strong><div ref={lane} className={styles.lane} style={{height:`calc(${Math.max(1,layout.laneCount)} * var(--timeline-lane-height))`}}>
 {cues.map(cue=>{const value=drag?.cue.id===cue.id?drag:cue;return <div role="button" tabIndex={0} aria-label={t('karaoke.timelineCue',{text:cue.text})} aria-pressed={shared.selectedCue===cue.id} className={styles.bar} key={cue.id} data-cue-id={cue.id} data-invalid={drag?.cue.id===cue.id&&!!drag.error||undefined}
 style={{left:`${(value.beginMs-startMs)/span*100}%`,width:`${(value.endMs-value.beginMs)/span*100}%`,top:`calc(${layout.lanes.get(cue.id)??0} * var(--timeline-lane-height) + var(--timeline-bar-inset))`}}
 onContextMenu={event=>{event.preventDefault();event.stopPropagation();shared.commands.current?.openContext(event.currentTarget,event.clientX,event.clientY);}} onClick={()=>shared.selectCue(cue.id,cue.anchor.lineId)} onPointerDown={e=>begin(e,cue,'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
 onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();shared.selectCue(cue.id,cue.anchor.lineId);}if(e.key==='Delete'&&!locked){e.stopPropagation();apply({type:'karaoke',command:{kind:'remove',id:cue.id}});}}}>
 <button className={styles.handle} aria-label={t('karaoke.guideBegin')} onPointerDown={e=>begin(e,cue,'beginMs')}/><span>{cue.text}</span><button className={styles.handle} aria-label={t('karaoke.guideEnd')} onPointerDown={e=>begin(e,cue,'endMs')}/></div>;})}</div></div>;
}

const t=i18n.t.bind(i18n);
