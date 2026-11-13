import { ContextMenu } from '../shared/ContextMenu';
import { MessageError, errorMessage, type Message, message as describeMessage } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { assertChangedTimes } from '../domain/time-boundaries';
import { IconButton } from '../shared/Controls';
import { useEditorSelection } from './editor/SelectionContext';
import { TimelineIndicators, TimelineIndicatorContext } from './TimelineIndicators';
import { waveformRequestWindow } from '../domain/timeline-viewport';
import { visibleEnergy } from '../domain/energy-window';
import { useAudioReview } from './AudioReviewContext';
import { VocalFocus } from './VocalFocus';
import { snapTimelineTime, timelineDelta } from '../domain/timeline-editing';
import { createPortal } from 'react-dom';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { packIntervals } from '../domain/pack-intervals';
import { editSegments } from '../domain/vocal-editing';
import type { Acoustics, VocalSegment } from '../domain/project-document';
import styles from './vocal.module.css';
type Props = { sourceDurationMs: number | null; locked?: boolean; children: ReactNode; bpm: number; snap: boolean; anchors: number[]; showEnergy: boolean; showSegments: boolean; lineLabel: string; projectId: string; acoustics: Acoustics; startMs: number; endMs: number; durationMs: number; selectedLineId: string | null; apply: (acoustics: Acoustics) => void; assign: (lineId: string, segment: VocalSegment) => void; pause: () => void };
type Drag = { error?: string | Message; segment?: VocalSegment; side: 'move'|'beginMs'|'endMs'|'new'; x: number; now: number; width: number; left: number; document: Acoustics; ids: string[]; candidate: VocalSegment };
export const VOCAL_LINE_MIME = 'application/x-studio-vocal-line';
export function VocalTracks(props: Props) {
  useTranslation();
  const { acoustics, startMs, endMs, durationMs } = props;
  const { publish } = useContext(TimelineIndicatorContext);
  const capture = useRef<{ element: HTMLElement; id: number } | null>(null);
  const sharedSelection = useEditorSelection()!;
  const {selected,setSelected,adding,setAdding,toolsHost}=useAudioReview();
  const addButton=useRef<HTMLButtonElement>(null);
  const showEnergy=props.showEnergy||adding, showSegments=props.showSegments||adding;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [error, setError] = useMessageText('');
  const [menu, setMenu] = useState<{x:number;y:number;target:HTMLElement} | null>(null);
  useEffect(() => { if (props.locked) setMenu(null); }, [props.locked]);
  const [dropId,setDropId] = useState<string | null>(null);
  const span = Math.max(1,endMs-startMs);
  const visible = acoustics.segments.filter(s=>s.endMs>startMs && s.beginMs<endMs);
  const layout = useMemo(()=>packIntervals(visible.map(s=>({key:s.id,...s}))),[acoustics,startMs,endMs]);
  const frozen = useRef(layout); if (!drag) frozen.current = layout;
  const requestWindow = waveformRequestWindow({ startMs, spanMs: span }, durationMs);
  const energy = useQuery({
    queryKey: ['vocal-energy', props.projectId, acoustics.analysisId, span, requestWindow.startMs, requestWindow.endMs],
    queryFn: ({signal}) => vocalApi.energy(props.projectId, acoustics.analysisId!, requestWindow.startMs, requestWindow.endMs, signal),
    enabled: showEnergy && !!acoustics.analysisId && endMs > startMs,
    staleTime: Infinity, gcTime: 0, retry: false,
    // Keep one previous window while fetching, but never reuse a different source/resolution.
    placeholderData: (data, query) => query?.queryKey[1] === props.projectId && query.queryKey[2] === acoustics.analysisId && query.queryKey[3] === span ? data : undefined,
  });
  const energyView = visibleEnergy(energy.data, startMs, endMs);
  const clearDrag = useCallback(() => {
    dragRef.current = null; setDrag(null); publish(null);
    const held = capture.current; capture.current = null;
    if (held?.element.hasPointerCapture(held.id)) held.element.releasePointerCapture(held.id);
  }, [publish]);
  useEffect(() => clearDrag, [clearDrag]);
  const cancel = useCallback(() => { clearDrag(); setAdding(false); setMenu(null); if(adding)requestAnimationFrame(()=>addButton.current?.focus()); },[adding,setAdding,clearDrag]);
  useEffect(()=>{
    const key = (e:KeyboardEvent)=>{if(e.key==='Escape'&&(dragRef.current||adding)){ e.preventDefault(); cancel(); }};
    window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key);
  },[adding,menu]);
  useEffect(() => { clearDrag(); }, [acoustics, startMs, endMs, props.showEnergy, props.showSegments, props.sourceDurationMs, clearDrag]);
  useEffect(()=>{setSelected(ids=>ids.filter(id=>acoustics.segments.some(s=>s.id===id)));},[acoustics,setSelected]);
  const sorted=useMemo(()=>[...acoustics.segments].sort((a,b)=>a.beginMs-b.beginMs||a.endMs-b.endMs||a.id.localeCompare(b.id)),[acoustics]);
  const labels=useMemo(()=>new Map(sorted.map((s,i)=>[s.id,`S${i+1}`])),[sorted]);
  const snapAt=(time:number,d:Drag)=>{
    const beat=60000/props.bpm;
    const anchors=[...props.anchors,...acoustics.segments.filter(s=>!d.ids.includes(s.id)).flatMap(s=>[s.beginMs,s.endMs]),Math.round(time/beat)*beat];
    return snapTimelineTime(time, anchors, span, d.width, props.snap);
  };
  const candidate = (d:Drag): VocalSegment => {
    const durationMs = props.sourceDurationMs;
    if (durationMs === null) throw new MessageError(describeMessage('vocal.sourceUnknown'));
    const delta=timelineDelta(d.now-d.x,d.width,span);
    if(d.side==='new') {
      const a=Math.max(0,Math.min(durationMs,snapAt(startMs+(d.x-d.left)/d.width*span,d)));
      const b=Math.max(0,Math.min(durationMs,snapAt(startMs+(d.now-d.left)/d.width*span,d)));
      return {id:'preview',beginMs:Math.min(a,b),endMs:Math.max(a,b)};
    }
    const s=d.segment!;
    if(d.now===d.x)return s;
    if(d.side==='move'){const group=acoustics.segments.filter(s=>d.ids.includes(s.id));const a=snapAt(s.beginMs+delta,d)-(s.beginMs+delta),b=snapAt(s.endMs+delta,d)-(s.endMs+delta);const correction=a!==0 && (b===0||Math.abs(a)<=Math.abs(b))?a:b;const shift=Math.max(-Math.min(...group.map(s=>s.beginMs)),Math.min(durationMs-Math.max(...group.map(s=>s.endMs)),delta+correction));return {...s,beginMs:s.beginMs+shift,endMs:s.endMs+shift};}
    return {...s,[d.side]:Math.max(d.side==='beginMs'?0:s.beginMs+1,Math.min(d.side==='beginMs'?Math.min(s.endMs-1,durationMs):durationMs,snapAt(s[d.side]+delta,d)))};
  };
  const begin = (e:PointerEvent<HTMLElement>,segment?:VocalSegment,side:Drag['side']='new')=>{
    if(props.locked || e.button!==0 || (!segment && !adding))return;
    e.preventDefault(); e.stopPropagation();
    if (props.sourceDurationMs === null) { setError(describeMessage('vocal.sourceUnknown')); return; }
    if(segment && (e.ctrlKey||e.metaKey||e.shiftKey)) {
      const sorted=[...acoustics.segments].sort((a,b)=>a.beginMs-b.beginMs||a.endMs-b.endMs||a.id.localeCompare(b.id));
      if(e.shiftKey&&selected.length){const a=sorted.findIndex(s=>s.id===(sharedSelection.effective?.anchorId ?? selected[0])),b=sorted.findIndex(s=>s.id===segment.id);setSelected(sorted.slice(Math.min(a,b),Math.max(a,b)+1).map(s=>s.id));}
      else setSelected(selected.includes(segment.id)?selected.filter(id=>id!==segment.id):[...selected,segment.id]);return;
    }

    if(segment && !selected.includes(segment.id))setSelected([segment.id]);
    const lane=e.currentTarget.closest('[data-vocal-lane]')??e.currentTarget.querySelector('[data-vocal-lane]')??e.currentTarget;
    const box=lane.getBoundingClientRect();
    const next: Drag = {segment,side,x:e.clientX,now:e.clientX,width:box.width,left:box.left,document:acoustics,ids:segment?(selected.includes(segment.id)?selected:[segment.id]):[], candidate: segment ?? { id: 'preview', beginMs: 0, endMs: 0 }};
    next.candidate = candidate(next);
    dragRef.current=next;setDrag(next);e.currentTarget.setPointerCapture(e.pointerId);
    capture.current = { element: e.currentTarget, id: e.pointerId };
    if (side !== 'new') publish({ timeMs: side === 'endMs' ? next.candidate.endMs : next.candidate.beginMs, valid: true });
  };
  const changed = (d: Drag, next: VocalSegment): Acoustics => d.side==='move'
    ? {...acoustics,segments:acoustics.segments.map(s=>d.ids.includes(s.id)?{...s,beginMs:s.beginMs+next.beginMs-d.segment!.beginMs,endMs:s.endMs+next.beginMs-d.segment!.beginMs}:s)}
    : {...acoustics,segments:[...acoustics.segments.filter(s=>s.id!==next.id),next]};
  const times = (value: Acoustics) => value.segments.map(s => ({...s,kind:'acoustic' as const,lineId:''}));
  const move=(e:PointerEvent<HTMLElement>)=>{if(dragRef.current){
    const next: Drag={...dragRef.current,now:e.clientX,error:''};next.candidate=candidate(next);
    try { assertChangedTimes(times(acoustics),times(changed(next,next.candidate)),props.sourceDurationMs); }
    catch(cause) { next.error=errorMessage(cause); }
    setError(next.error ?? '');dragRef.current=next;setDrag(next);
    if(next.side!=='new')publish({timeMs:next.side==='endMs'?next.candidate.endMs:next.candidate.beginMs,valid:!next.error});
  }};
  const finish=()=>{
    const d=dragRef.current;clearDrag();if(!d)return;
    if(d.document!==acoustics || d.error)return;
    const next=d.candidate;
    if(d.side==='new'){setAdding(false);requestAnimationFrame(()=>addButton.current?.focus());if(next.beginMs===next.endMs)return;next.id=crypto.randomUUID();}
    else if(next.beginMs===d.segment!.beginMs&&next.endMs===d.segment!.endMs)return;
    try{const updated = changed(d,next);
      assertChangedTimes(times(acoustics),times(updated),props.sourceDurationMs);
      props.apply(updated);setSelected(d.side==='move'?d.ids:[next.id]);setError('');}catch(e){setError(errorMessage(e));}
  };
  const operate=(type:'merge'|'delete')=>{try{const next=editSegments(acoustics,{type,ids:selected});props.apply(next);setSelected(type==='merge'?next.segments.filter(s=>selected.includes(s.id)).map(s=>s.id):[]);setError('');}catch(e){setError(errorMessage(e));}setMenu(null);};
  const assign=(lineId:string|null,segment:VocalSegment|undefined)=>{if(!lineId||!segment)return;try{props.assign(lineId,segment);setError('');}catch(e){setError(errorMessage(e));}setMenu(null);};
  const active=selected.length===1?acoustics.segments.find(s=>s.id===selected[0]):undefined;
  const preview=drag?.candidate??null;
  const pct=(time:number)=>(time-startMs)/span*100;
  const upper=energyView?.upper??null;
  return <div className={styles.tracks} data-vocal-tracks data-vocal-focus tabIndex={-1} onPointerDownCapture={e=>{if(adding&&e.currentTarget.contains(e.target as Node))begin(e);}} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={clearDrag}>
    <VocalFocus active={adding} cancel={cancel}/>
    {toolsHost && createPortal(<><span data-vocal-hint>{adding?t('vocal.dragCreate'):[props.lineLabel,selected.length===1?labels.get(selected[0]):selected.length?t('vocal.selectedCount',{count:selected.length}):''].filter(Boolean).join(' → ')||t('vocal.noSelection')}</span><button data-role="primary" disabled={props.locked||adding||!active||!props.selectedLineId} onClick={()=>assign(props.selectedLineId,active)}>{t('vocal.assign')}</button><button data-role="secondary" ref={addButton} disabled={props.locked||adding} onClick={()=>{props.pause();setAdding(true);setMenu(null);}}>{t('vocal.newSegment')}</button></>,toolsHost)}
    {props.children}
    {error&&<p role="alert">{error}</p>}
    {showEnergy && <div className={styles.segmentRow}><strong>{t('vocal.energy')}</strong><div className={styles.energyFrame} data-wheel-zoom data-timeline-pan="seek" tabIndex={-1}>
      <svg className={styles.energy} viewBox="0 0 1000 55" preserveAspectRatio="none" aria-label={t('vocal.energyLabel')}><polyline fill="none" stroke="currentColor" strokeWidth="1" points={upper?energyView!.values.map((v,i)=>`${pct(energyView!.start_ms+i*energyView!.step_ms)*10},${54-v/upper*52}`).join(' '):''}/></svg>
      {!energy.isError && <TimelineIndicators playback />}
      {upper!==null && <small className={styles.scale}>{upper}</small>}
      {energy.isError && <span className={styles.energyError} role="alert">{t('vocal.energyFailed')}<IconButton icon="refresh" label={t('vocal.retryEnergy')} onClick={()=>void energy.refetch()}/></span>}
    </div></div>}
    {showSegments && <div className={styles.segmentRow}><strong>{t('vocal.segment')}</strong><div data-wheel-zoom data-vocal-lane data-timeline-pan="pan" tabIndex={-1} className={styles.lane} style={{height:`calc(${Math.max(1,frozen.current.laneCount)} * var(--timeline-lane-height))`}} onPointerDown={e=>begin(e)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={clearDrag}>
      {visible.map(s=>{const p=preview&&drag?.side==='move'&&drag.ids.includes(s.id)?{...s,beginMs:s.beginMs+preview.beginMs-drag.segment!.beginMs,endMs:s.endMs+preview.beginMs-drag.segment!.beginMs}:preview&&drag?.segment?.id===s.id?preview:s;return <button data-role="secondary" key={s.id} className={styles.segment} data-segment-id={s.id} title={t('vocal.interval',{label:labels.get(s.id),begin:s.beginMs,end:s.endMs})} aria-label={t('vocal.segmentLabel',{label:labels.get(s.id),begin:s.beginMs,end:s.endMs})} aria-pressed={selected.includes(s.id)} style={{left:`${Math.max(0,pct(p.beginMs))}%`,width:`${Math.min(100,pct(p.endMs))-Math.max(0,pct(p.beginMs))}%`,top:`calc(${frozen.current.lanes.get(s.id)??0} * var(--timeline-lane-height) + var(--timeline-bar-inset))`,outline:dropId===s.id?'3px solid var(--primary, #3367ab)':undefined}} onPointerDown={e=>{if(!adding)begin(e,s,'move');}} onClick={e=>{if(e.detail===0 && !selected.includes(s.id)){setSelected([s.id]);}}} onKeyDown={e=>{if(!props.locked&&(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')){e.preventDefault();if(!selected.includes(s.id))setSelected([s.id]);const r=e.currentTarget.getBoundingClientRect();setMenu({x:r.left,y:r.bottom,target:e.currentTarget});}}} onContextMenu={e=>{if(props.locked){e.preventDefault();return;}e.preventDefault();if(adding)return;if(!selected.includes(s.id))setSelected([s.id]);setMenu({x:e.clientX,y:e.clientY,target:e.currentTarget});}} onDragOver={e=>{if(props.locked)return;if(!adding&&e.dataTransfer.types.includes(VOCAL_LINE_MIME)){e.preventDefault();setDropId(s.id);}}} onDragLeave={()=>setDropId(null)} onDrop={e=>{if(props.locked)return;e.preventDefault();setDropId(null);if(adding)return;const id=e.dataTransfer.getData(VOCAL_LINE_MIME);if(id){setSelected([s.id]);assign(id,s);}}}>
        <span>{labels.get(s.id)}</span><span className={`${styles.edge} ${styles.begin}`} onPointerDown={e=>{if(!adding)begin(e,s,'beginMs');}}/><span className={`${styles.edge} ${styles.end}`} onPointerDown={e=>{if(!adding)begin(e,s,'endMs');}}/>
      </button>;})}
      {preview&&drag?.side==='new'&&<span className={styles.newRange} style={{left:`${pct(preview.beginMs)}%`,width:`${pct(preview.endMs)-pct(preview.beginMs)}%`}}/>}
      <TimelineIndicators />
    </div></div>}
    {menu && !props.locked && <ContextMenu {...menu} title={t('vocal.segment')} close={()=>setMenu(null)} actions={[
      {label:t('vocal.assignSelected'),disabled:adding||!active||!props.selectedLineId,run:()=>assign(props.selectedLineId,active)},
      {label:t('vocal.mergeSelected'),disabled:adding||selected.length<2,run:()=>operate('merge')},
      {label:t('vocal.deleteSelected'),danger:true,disabled:adding||!selected.length,run:()=>operate('delete')},
    ]}/>}

  </div>;
}

const t=i18n.t.bind(i18n);
