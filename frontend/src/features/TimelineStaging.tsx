import {useStagingIgnoredCharacters} from '../adapters/timeline-preferences';
import {stagingItems,stagingRows,type StagingItem,type StagingRow} from './editor/staging-layout';
import {selectionLineId} from './editor/editing-actions';
import { Tooltip } from '../shared/Tooltip';
import { KaraokeContext } from './KaraokeContext';
import {createProjectEditorState,executeProjectCommand} from '../domain/project-document';
import { useContext, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import { prepareTimelineAssignment, applyTimelineAssignment, snapTimelineInterval, type TimelineTarget } from '../domain/timeline-editing';
import { assertChangedTimes, lyricTimes, projectTimes } from '../domain/time-boundaries';
import { errorMessage } from '../domain/messages';
import { useProjectEditing } from './editor/ProjectEditingContext';
import { useEditorSelection } from './editor/SelectionContext';
import { lyricSnapAnchors, stableSnapAnchor, targetId, targetInterval, targetSelection } from './editor/selection-targets';
import styles from './media.module.css';

type Props={clearPreview?: boolean;document:LyricDocument;startMs:number;endMs:number;durationMs:number|null;snap:boolean;bpm:number;anchors:number[];locked?:boolean;
  visible:{line:boolean;word:boolean;ruby:boolean;romanization:boolean};host:React.RefObject<HTMLDivElement|null>;
  apply:(command:LyricCommand)=>void;onLocate?:(begin:number,end:number)=>void;onError:(error:ReturnType<typeof errorMessage>|'')=>void};
type Item=StagingItem;
type Gesture={target:TimelineTarget;rows:StagingRow[];width:number;x:number;y:number;started:boolean;element:HTMLElement;pointer:number;candidate:LyricDocument|null;lane:HTMLElement|null};

export function TimelineStaging({clearPreview,document,startMs,endMs,durationMs,snap,bpm,anchors,locked,visible,host,apply,onLocate,onError}:Props){
  const {t}=useTranslation();
  const editing=useProjectEditing();
  const [ignored]=useStagingIgnoredCharacters();
  const projectContext=useContext(KaraokeContext);
  const {selection,setSelection}=useEditorSelection()!;
  const [gesture,setGesture]=useState<Gesture|null>(null), active=useRef<Gesture|null>(null);
  const reset=()=>{const current=active.current;active.current=null;setGesture(null);if(current?.element.hasPointerCapture(current.pointer))current.element.releasePointerCapture(current.pointer);};
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&active.current){event.preventDefault();reset();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);reset();};},[]);
  useEffect(()=>{reset();},[document,durationMs,locked,startMs,endMs,visible.line,visible.word,visible.ruby,visible.romanization,ignored]);
  const ordinalById=new Map(document.lines.filter(line=>!line.backgroundOf).map((line,index)=>[line.id,index+1]));
  const rows=gesture?.rows??stagingRows(stagingItems(document,durationMs,ignored),selectionLineId(selection),visible);
  const label=(item:Item)=>{
    if(item.target.kind!=='line')return item.text;
    const line=document.lines.find(line=>line.id===item.target.lineId)!;
    return `L${ordinalById.get(line.backgroundOf??line.id)}${line.backgroundOf?` ${t('outline.background')}`:''}`;
  };
  const choose=(item:Item)=>{setSelection(targetSelection(item.target));if(!item.assignable){const interval=targetInterval(document,item.target)!;const times=[interval.beginMs,interval.endMs].filter((time):time is number=>time!==null);if(times.length)onLocate?.(Math.min(...times),Math.max(...times));}};
  const begin=(event:PointerEvent<HTMLElement>,item:Item)=>{
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    if(!item.assignable||locked){choose(item);return;}
    const next:Gesture={target:item.target,rows,width:event.currentTarget.closest('[data-staging-lane]')!.getBoundingClientRect().width,x:event.clientX,y:event.clientY,started:false,element:event.currentTarget,pointer:event.pointerId,candidate:null,lane:null};
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
        const drop=startMs+(event.clientX-rect.left)/rect.width*(endMs-startMs);
        try{
          const assignment=prepareTimelineAssignment(document,current.target,drop,durationMs);
          const validate=(candidate:LyricDocument)=>{
            if(projectContext){const preview=executeProjectCommand(createProjectEditorState(projectContext.project),{type:'lyrics',command:{type:'replace-document',document:candidate}});assertChangedTimes(projectTimes(projectContext.project),projectTimes(preview.present),durationMs);}
            else assertChangedTimes(lyricTimes(document),lyricTimes(candidate),durationMs);
          };
          const base=applyTimelineAssignment(document,current.target,assignment,0,editing);validate(base);
          const options=lyricSnapAnchors(document,null,target=>targetId(target)===targetId(current.target),points);
          let candidate=base;
          if(!assignment.fixed)snapTimelineInterval(assignment.beginMs,assignment.endMs,options.map(option=>option.time),endMs-startMs,rect.width,snap,(delta,index)=>{
            try{const shifted=applyTimelineAssignment(document,current.target,assignment,delta,editing);validate(shifted);if(!stableSnapAnchor(options[index],shifted))return false;candidate=shifted;return true;}catch{return false;}
          });
          next.candidate=candidate;next.lane=lane;onError('');
        }catch(error){next.candidate=null;onError(errorMessage(error));}
      }
    }
    active.current=next;setGesture(next);
  };
  const finish=()=>{const current=active.current;reset();if(current?.started&&current.candidate&&current.lane){apply({type:'replace-document',document:current.candidate});onError('');}};
  const preview=gesture?.candidate?targetInterval(gesture.candidate,gesture.target):null;
  return <>
    <div tabIndex={-1} data-staging-drop data-clearing={clearPreview||undefined} className={styles.staging} aria-label={t('timeline.staging')}><small className={styles.stagingLabel}>{clearPreview?t('timeline.clearTimes'):t('timeline.staging')}</small><div className={styles.stagingContent}>
      {rows.map(row=><div className={styles.trackRow} key={row.key}><strong data-timeline-text>{t(row.kind==='line'?'selection.line':row.kind==='word'?'selection.word':row.kind==='ruby'?'selection.ruby':row.key.startsWith('translation:')?'capability.translation':'media.romanization')}</strong><div data-staging-lane className={styles.stagingLane}>
        <div className={styles.stagingGroup} style={{width:gesture?Math.min(gesture.width,row.width):`min(100%, ${row.width}px)`}}>
        {row.slots.map(({item,left,width})=><Tooltip key={targetId(item.target)} className={styles.stagingSlot} style={{left:`${left/row.width*100}%`,width:`${width/row.width*100}%`}} content={label(item)}><div role="button" tabIndex={0} data-staging-key={targetId(item.target)} data-staging-assignable={item.assignable} aria-disabled={locked&&item.assignable||undefined} aria-label={label(item)} aria-pressed={selection?.ids.includes(targetId(item.target))??false}
          className={`${styles.trackBar} ${styles.stagingBlock} ${item.assignable?'':styles.stagingContext} ${selection?.ids.includes(targetId(item.target))?styles.trackSelected:''}`}
          onPointerDown={event=>begin(event,item)} onPointerMove={move} onPointerUp={finish} onPointerCancel={reset} onLostPointerCapture={reset}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(item);}}}>
          <span aria-hidden="true" className={`${styles.trackHandle} ${item.beginMissing?styles.temporaryHandle:''}`} />
          <span className={styles.trackBarText}>{label(item)}</span>
          <span aria-hidden="true" className={`${styles.trackHandle} ${item.endMissing?styles.temporaryHandle:''}`} />
        </div></Tooltip>)}
        </div>
      </div></div>)}
    </div></div>
    {preview&&gesture?.lane&&createPortal(<div className={styles.assignmentPreview} style={{left:`${(preview.beginMs!-startMs)/(endMs-startMs)*100}%`,width:`${(preview.endMs!-preview.beginMs!)/(endMs-startMs)*100}%`}}>{preview.beginMs}–{preview.endMs} ms</div>,gesture.lane)}
  </>;
}
