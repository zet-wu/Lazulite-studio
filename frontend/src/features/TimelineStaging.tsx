import { Tooltip } from '../shared/Tooltip';
import { KaraokeContext } from './KaraokeContext';
import {createProjectEditorState,executeProjectCommand} from '../domain/project-document';
import { useContext, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import { assignTimeline, snapTimelineTime, type TimelineTarget } from '../domain/timeline-editing';
import { projectTimeline } from '../domain/timeline-projection';
import { assertChangedTimes, lyricTimes, projectTimes } from '../domain/time-boundaries';
import { errorMessage } from '../domain/messages';
import { useProjectEditing } from './editor/ProjectEditingContext';
import { useEditorSelection } from './editor/SelectionContext';
import { documentTargets, targetId, targetInterval, targetSelection } from './editor/selection-targets';
import styles from './media.module.css';

type Props={document:LyricDocument;startMs:number;endMs:number;durationMs:number|null;snap:boolean;bpm:number;anchors:number[];locked?:boolean;
  visible:{line:boolean;word:boolean;ruby:boolean;romanization:boolean};host:React.RefObject<HTMLDivElement|null>;
  apply:(command:LyricCommand)=>void;onLocate?:(begin:number,end:number)=>void;onError:(error:ReturnType<typeof errorMessage>|'')=>void};
type Item={target:TimelineTarget;missing:boolean;text:string};
type Gesture={target:TimelineTarget;items:Item[];x:number;y:number;started:boolean;element:HTMLElement;pointer:number;candidate:LyricDocument|null;lane:HTMLElement|null};

export function TimelineStaging({document,startMs,endMs,durationMs,snap,bpm,anchors,locked,visible,host,apply,onLocate,onError}:Props){
  const {t}=useTranslation();
  const editing=useProjectEditing();
  const projectContext=useContext(KaraokeContext);
  const {selection,setSelection}=useEditorSelection()!;
  const [gesture,setGesture]=useState<Gesture|null>(null), active=useRef<Gesture|null>(null);
  const reset=()=>{const current=active.current;active.current=null;setGesture(null);if(current?.element.hasPointerCapture(current.pointer))current.element.releasePointerCapture(current.pointer);};
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&active.current){event.preventDefault();reset();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);reset();};},[]);
  useEffect(()=>{reset();},[document,durationMs,locked,startMs,endMs,visible.line,visible.word,visible.ruby,visible.romanization]);
  const targets=documentTargets(document), projected=projectTimeline(document,durationMs);
  const missing=new Set(targets.filter(target=>{const item=targetInterval(projected,target);return item&&(item.beginMs===null||item.endMs===null);}).map(targetId));
  const included=new Set(missing);
  for(const target of targets)if(missing.has(targetId(target))){included.add(target.lineId);if(target.kind==='ruby')included.add(target.wordId);}
  const activeLine=selection?.kind==='lines'?selection.activeId:selection?.lineId;
  const items=gesture?.items??targets.filter(target=>included.has(targetId(target))&&visible[target.kind]&&(activeLine?target.lineId===activeLine&&target.kind!=='line':target.kind==='line')).map(target=>{
    const item=targetInterval(document,target)!;
    const text=target.kind==='line'?document.lines.find(l=>l.id===target.lineId)!.words.map(w=>w.text).join(''):'text'in item?item.text:'reading'in item?item.reading:'';
    return {target,missing:item.beginMs===null||item.endMs===null,text};
  });
  const choose=(item:Item)=>{setSelection(targetSelection(item.target));if(!item.missing){const interval=targetInterval(document,item.target)!;onLocate?.(interval.beginMs!,interval.endMs!);}};
  const begin=(event:PointerEvent<HTMLElement>,item:Item)=>{
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    if(!item.missing||locked){choose(item);return;}
    const next:Gesture={target:item.target,items,x:event.clientX,y:event.clientY,started:false,element:event.currentTarget,pointer:event.pointerId,candidate:null,lane:null};
    active.current=next;setGesture(next);event.currentTarget.setPointerCapture(event.pointerId);setSelection(targetSelection(item.target));
  };
  const move=(event:PointerEvent<HTMLElement>)=>{
    const current=active.current;if(!current)return;
    const next={...current,started:current.started||Math.hypot(event.clientX-current.x,event.clientY-current.y)>3,candidate:null as LyricDocument|null,lane:null as HTMLElement|null};
    const lane=window.document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-assignment-kind]');
    if(next.started&&lane&&host.current?.contains(lane)&&lane.dataset.assignmentKind===current.target.kind&&durationMs!==null){
      const rect=lane.getBoundingClientRect();
      if(event.clientX>=rect.left&&event.clientX<=rect.right){
        const points=[...anchors];if(bpm>0)for(let x=Math.ceil(startMs/(60000/bpm))*(60000/bpm);x<endMs&&points.length<20000;x+=60000/bpm)points.push(Math.round(x));
        const drop=snapTimelineTime(startMs+(event.clientX-rect.left)/rect.width*(endMs-startMs),points,endMs-startMs,rect.width,snap);
        try{next.candidate=assignTimeline(document,current.target,drop,durationMs,editing);if(projectContext){const preview=executeProjectCommand(createProjectEditorState(projectContext.project),{type:'lyrics',command:{type:'replace-document',document:next.candidate}});assertChangedTimes(projectTimes(projectContext.project),projectTimes(preview.present),durationMs);}else assertChangedTimes(lyricTimes(document),lyricTimes(next.candidate),durationMs);next.lane=lane;onError('');}catch(error){next.candidate=null;onError(errorMessage(error));}
      }
    }
    active.current=next;setGesture(next);
  };
  const finish=()=>{const current=active.current;reset();if(current?.started&&current.candidate&&current.lane){apply({type:'replace-document',document:current.candidate});onError('');}};
  const preview=gesture?.candidate?targetInterval(gesture.candidate,gesture.target):null;
  return <>
    {items.length>0&&<div className={styles.staging} aria-label={t('timeline.staging')}><small className={styles.stagingLabel}>{t('timeline.staging')}</small>
      {(['line','word','ruby','romanization'] as const).map(kind=>{const group=items.filter(item=>item.target.kind===kind);return group.length?<div className={styles.trackRow} key={kind}><strong>{t(kind==='line'?'selection.line':kind==='word'?'selection.word':kind==='ruby'?'selection.ruby':'media.romanization')}</strong><div className={styles.stagingLane}>
        {group.map(item=><Tooltip key={targetId(item.target)} className={styles.stagingSlot} content={item.text}><div role="button" tabIndex={0} data-staging-key={targetId(item.target)} aria-label={item.text} aria-pressed={selection?.ids.includes(targetId(item.target))??false}
          className={`${styles.stagingBlock} ${item.missing?styles.stagingMissing:styles.stagingContext} ${selection?.ids.includes(targetId(item.target))?styles.trackSelected:''}`}
          onPointerDown={event=>begin(event,item)} onPointerMove={move} onPointerUp={finish} onPointerCancel={reset} onLostPointerCapture={reset}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(item);}}}>
          <span className={styles.trackBarText}>{item.text}</span>
        </div></Tooltip>)}
      </div></div>:null;})}
    </div>}
    {preview&&gesture?.lane&&createPortal(<div className={styles.assignmentPreview} style={{left:`${(preview.beginMs!-startMs)/(endMs-startMs)*100}%`,width:`${(preview.endMs!-preview.beginMs!)/(endMs-startMs)*100}%`}}>{preview.beginMs}–{preview.endMs} ms</div>,gesture.lane)}
  </>;
}
