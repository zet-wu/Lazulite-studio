import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useKaraokeProject } from './KaraokeContext';
import { useEditorSelection } from './editor/SelectionContext';
import { cueProblem, type KaraokeCue } from '../domain/karaoke';
import { packIntervals } from '../domain/pack-intervals';
import { snapTimelineTime, timelineDelta } from '../domain/timeline-editing';
import styles from './karaoke.module.css';
type Drag = { cue: KaraokeCue; side:'move'|'beginMs'|'endMs'; x:number; width:number; beginMs:number; endMs:number; error:string; pointer:number; element:HTMLElement };
export function KaraokeTrack({startMs,endMs,snap,bpm,anchors,onError}:{startMs:number;endMs:number;snap:boolean;bpm:number;anchors:number[];onError:(message:string)=>void}) {
 const context=useKaraokeProject(),shared=useEditorSelection()!,lane=useRef<HTMLDivElement>(null),[drag,setDrag]=useState<Drag|null>(null),current=useRef<Drag|null>(null);
 const cancel=()=>{const value=current.current;current.current=null;setDrag(null);if(value?.element.hasPointerCapture(value.pointer))value.element.releasePointerCapture(value.pointer);};
 useEffect(()=>{cancel();},[context?.project,startMs,endMs]);
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
  const error=cueProblem(project.lyrics,project.karaoke,{...value.cue,beginMs,endMs:end})??'';
  current.current={...value,beginMs,endMs:end,error};setDrag(current.current);onError(error);
 };
 const finish=()=>{const value=current.current;cancel();if(!value||value.error)return;try{apply({type:'karaoke',command:{kind:'cue',id:value.cue.id,text:value.cue.text,beginMs:value.beginMs,endMs:value.endMs}});}catch(e){onError((e as Error).message);}};
 return <div className={styles.track} aria-label="导唱轨道"><strong>导唱</strong><div ref={lane} className={styles.lane} style={{height:Math.max(1,layout.laneCount)*32}}>
 {cues.map(cue=>{const value=drag?.cue.id===cue.id?drag:cue;return <div role="button" tabIndex={0} aria-label={`时间轴导唱 ${cue.text}`} aria-pressed={shared.selectedCue===cue.id} className={styles.bar} key={cue.id} data-cue-id={cue.id} data-invalid={drag?.cue.id===cue.id&&!!drag.error||undefined}
 style={{left:`${(value.beginMs-startMs)/span*100}%`,width:`${(value.endMs-value.beginMs)/span*100}%`,top:(layout.lanes.get(cue.id)??0)*32+3}}
 onClick={()=>shared.selectCue(cue.id,cue.anchor.lineId)} onPointerDown={e=>begin(e,cue,'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
 onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();shared.selectCue(cue.id,cue.anchor.lineId);}if(e.key==='Delete'&&!locked){e.stopPropagation();apply({type:'karaoke',command:{kind:'remove',id:cue.id}});}}}>
 <button className={styles.handle} aria-label="导唱开始端点" onPointerDown={e=>begin(e,cue,'beginMs')}/><span>{cue.text}</span><button className={styles.handle} aria-label="导唱结束端点" onPointerDown={e=>begin(e,cue,'endMs')}/></div>;})}</div></div>;
}
