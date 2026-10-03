import { waveformRequestWindow } from '../domain/timeline-viewport';
import { visibleEnergy } from '../domain/energy-window';
import { useAudioReview } from './AudioReviewContext';
import { VocalFocus } from './VocalFocus';
import { snapTime } from '../domain/timeline-editing';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { packIntervals } from '../domain/pack-intervals';
import { editSegments } from '../domain/vocal-editing';
import type { Acoustics, VocalSegment } from '../domain/project-document';
import styles from './vocal.module.css';
type Props = { children: ReactNode; bpm: number; snap: boolean; anchors: number[]; showEnergy: boolean; showSegments: boolean; lineLabel: string; projectId: string; acoustics: Acoustics; startMs: number; endMs: number; durationMs: number; positionMs: number; selectedLineId: string | null; apply: (acoustics: Acoustics) => void; assign: (lineId: string, segment: VocalSegment) => void; pause: () => void };
type Drag = { segment?: VocalSegment; side: 'move'|'beginMs'|'endMs'|'new'; x: number; now: number; width: number; left: number; document: Acoustics; ids: string[] };
export const VOCAL_LINE_MIME = 'application/x-studio-vocal-line';
export function VocalTracks(props: Props) {
  const { acoustics, startMs, endMs, durationMs } = props;
  const {selected,setSelected,adding,setAdding,setSegmentTarget,toolsHost}=useAudioReview();
  const addButton=useRef<HTMLButtonElement>(null);
  const showEnergy=props.showEnergy||adding, showSegments=props.showSegments||adding;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
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
  const cancel = useCallback(() => { dragRef.current=null; setDrag(null); setAdding(false); setMenu(null); if(adding)requestAnimationFrame(()=>addButton.current?.focus()); },[adding,setAdding]);
  useEffect(()=>{
    const key = (e:KeyboardEvent)=>{if(e.key==='Escape'&&(dragRef.current||menu||adding)){ e.preventDefault(); cancel(); }};
    window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key);
  },[adding,menu]);
  useEffect(()=>{if(dragRef.current && dragRef.current.document!==acoustics){dragRef.current=null;setDrag(null);}},[acoustics]);
  useEffect(()=>{setSelected(ids=>ids.filter(id=>acoustics.segments.some(s=>s.id===id)));},[acoustics,setSelected]);
  const sorted=useMemo(()=>[...acoustics.segments].sort((a,b)=>a.beginMs-b.beginMs||a.endMs-b.endMs||a.id.localeCompare(b.id)),[acoustics]);
  const labels=useMemo(()=>new Map(sorted.map((s,i)=>[s.id,`S${i+1}`])),[sorted]);
  const snapAt=(time:number,d:Drag)=>{
    if(!props.snap)return Math.round(time);
    const beat=60000/props.bpm;
    const anchors=[...props.anchors,...acoustics.segments.filter(s=>!d.ids.includes(s.id)).flatMap(s=>[s.beginMs,s.endMs]),Math.round(time/beat)*beat];
    return Math.round(snapTime(time,anchors,span/d.width*8));
  };
  const candidate = (d:Drag): VocalSegment => {
    const delta=Math.round((d.now-d.x)/d.width*span);
    if(d.side==='new') {
      const a=Math.max(0,Math.min(durationMs,snapAt(startMs+(d.x-d.left)/d.width*span,d)));
      const b=Math.max(0,Math.min(durationMs,snapAt(startMs+(d.now-d.left)/d.width*span,d)));
      return {id:'preview',beginMs:Math.min(a,b),endMs:Math.max(a,b)};
    }
    const s=d.segment!;
    if(d.now===d.x)return s;
    if(d.side==='move'){const group=acoustics.segments.filter(s=>d.ids.includes(s.id));const a=snapAt(s.beginMs+delta,d)-(s.beginMs+delta),b=snapAt(s.endMs+delta,d)-(s.endMs+delta);const correction=a!==0 && (b===0||Math.abs(a)<=Math.abs(b))?a:b;const shift=Math.max(-Math.min(...group.map(s=>s.beginMs)),Math.min(durationMs-Math.max(...group.map(s=>s.endMs)),delta+correction));return {...s,beginMs:s.beginMs+shift,endMs:s.endMs+shift};}
    return {...s,[d.side]:Math.max(d.side==='beginMs'?0:s.beginMs+1,Math.min(d.side==='beginMs'?s.endMs-1:durationMs,snapAt(s[d.side]+delta,d)))};
  };
  const begin = (e:PointerEvent<HTMLElement>,segment?:VocalSegment,side:Drag['side']='new')=>{
    if(e.button!==0 || (!segment && !adding))return;
    e.preventDefault(); e.stopPropagation(); setSegmentTarget(true);
    if(segment && (e.ctrlKey||e.metaKey||e.shiftKey)) {
      const sorted=[...acoustics.segments].sort((a,b)=>a.beginMs-b.beginMs||a.endMs-b.endMs||a.id.localeCompare(b.id));
      if(e.shiftKey&&selected.length){const a=sorted.findIndex(s=>s.id===selected.at(-1)),b=sorted.findIndex(s=>s.id===segment.id);setSelected(sorted.slice(Math.min(a,b),Math.max(a,b)+1).map(s=>s.id));}
      else setSelected(selected.includes(segment.id)?selected.filter(id=>id!==segment.id):[...selected,segment.id]);return;
    }
    setSegmentTarget(true);
    if(segment && !selected.includes(segment.id))setSelected([segment.id]);
    const lane=e.currentTarget.closest('[data-vocal-lane]')??e.currentTarget.querySelector('[data-vocal-lane]')??e.currentTarget;
    const box=lane.getBoundingClientRect();
    const next={segment,side,x:e.clientX,now:e.clientX,width:box.width,left:box.left,document:acoustics,ids:segment?(selected.includes(segment.id)?selected:[segment.id]):[]};
    dragRef.current=next;setDrag(next);e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move=(e:PointerEvent<HTMLElement>)=>{if(dragRef.current){const next={...dragRef.current,now:e.clientX};dragRef.current=next;setDrag(next);}};
  const finish=()=>{
    const d=dragRef.current;dragRef.current=null;setDrag(null);if(!d)return;
    if(d.document!==acoustics)return;
    const next=candidate(d);
    if(d.side==='new'){setAdding(false);requestAnimationFrame(()=>addButton.current?.focus());if(next.beginMs===next.endMs)return;next.id=crypto.randomUUID();}
    else if(next.beginMs===d.segment!.beginMs&&next.endMs===d.segment!.endMs)return;
    try{props.apply(d.side==='move'?{...acoustics,segments:acoustics.segments.map(s=>d.ids.includes(s.id)?{...s,beginMs:s.beginMs+next.beginMs-d.segment!.beginMs,endMs:s.endMs+next.beginMs-d.segment!.beginMs}:s)}:editSegments(acoustics,{type:'put',segment:next},durationMs));setSelected(d.side==='move'?d.ids:[next.id]);setError('');}catch(e){setError((e as Error).message);}
  };
  const operate=(type:'merge'|'delete')=>{try{const next=editSegments(acoustics,{type,ids:selected},durationMs);props.apply(next);setSelected(type==='merge'?next.segments.filter(s=>selected.includes(s.id)).map(s=>s.id):[]);setError('');}catch(e){setError((e as Error).message);}setMenu(null);};
  const assign=(lineId:string|null,segment:VocalSegment|undefined)=>{if(!lineId||!segment)return;try{props.assign(lineId,segment);setError('');}catch(e){setError((e as Error).message);}setMenu(null);};
  const active=selected.length===1?acoustics.segments.find(s=>s.id===selected[0]):undefined;
  const preview=drag?candidate(drag):null;
  const pct=(time:number)=>(time-startMs)/span*100;
  const upper=energyView?.upper??null;
  return <div data-vocal-tracks data-vocal-focus tabIndex={-1} onPointerDownCapture={e=>{if(adding&&e.currentTarget.contains(e.target as Node))begin(e);}} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
    <VocalFocus active={adding} cancel={cancel}/>
    {toolsHost && createPortal(<><span data-vocal-hint>{adding?'拖动框选新建片段':[props.lineLabel,selected.length===1?labels.get(selected[0]):selected.length?`片段已选 ${selected.length}`:''].filter(Boolean).join(' → ')||'未选择'}</span><button data-role="primary" disabled={adding||!active||!props.selectedLineId} onClick={()=>assign(props.selectedLineId,active)}>分配</button><button data-role="secondary" ref={addButton} disabled={adding} onClick={()=>{props.pause();setAdding(true);setMenu(null);}}>新建人声片段</button></>,toolsHost)}
    {props.children}
    {error&&<p role="alert">{error}</p>}
    {showEnergy && <div className={styles.segmentRow}><strong>能量</strong><div className={styles.energyFrame} data-wheel-zoom>
      <svg className={styles.energy} viewBox="0 0 1000 55" preserveAspectRatio="none" aria-label="人声能量"><polyline fill="none" stroke="currentColor" strokeWidth="1" points={upper?energyView!.values.map((v,i)=>`${pct(energyView!.start_ms+i*energyView!.step_ms)*10},${54-v/upper*52}`).join(' '):''}/></svg>
      {upper!==null && <small className={styles.scale}>{upper}</small>}
      {energy.isError && <button className={styles.energyError} data-role="inline" onClick={()=>void energy.refetch()}>能量加载失败 · 重试</button>}
    </div></div>}
    {showSegments && <div className={styles.segmentRow}><strong>片段</strong><div data-vocal-lane className={styles.lane} style={{height:Math.max(1,frozen.current.laneCount)*22+4}} onPointerDown={e=>begin(e)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(dragRef.current?.side==='new')setAdding(false);dragRef.current=null;setDrag(null);}}>
      {visible.map(s=>{const p=preview&&drag?.side==='move'&&drag.ids.includes(s.id)?{...s,beginMs:s.beginMs+preview.beginMs-drag.segment!.beginMs,endMs:s.endMs+preview.beginMs-drag.segment!.beginMs}:preview&&drag?.segment?.id===s.id?preview:s;return <button data-role="secondary" key={s.id} className={styles.segment} data-segment-id={s.id} title={`${labels.get(s.id)} · ${s.beginMs}–${s.endMs} 毫秒`} aria-label={`人声片段 ${labels.get(s.id)} ${s.beginMs}–${s.endMs} 毫秒`} aria-pressed={selected.includes(s.id)} style={{left:`${Math.max(0,pct(p.beginMs))}%`,width:`${Math.min(100,pct(p.endMs))-Math.max(0,pct(p.beginMs))}%`,top:(frozen.current.lanes.get(s.id)??0)*22+2,outline:dropId===s.id?'3px solid var(--primary, #3367ab)':undefined}} onPointerDown={e=>{if(!adding)begin(e,s,'move');}} onClick={e=>{if(e.detail===0){setSelected([s.id]);setSegmentTarget(true);}}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();if(!selected.includes(s.id))setSelected([s.id]);setSegmentTarget(true);const r=e.currentTarget.getBoundingClientRect();setMenu({x:r.left,y:r.bottom});}}} onContextMenu={e=>{e.preventDefault();if(adding)return;if(!selected.includes(s.id))setSelected([s.id]);setMenu({x:e.clientX,y:e.clientY});}} onDragOver={e=>{if(!adding&&e.dataTransfer.types.includes(VOCAL_LINE_MIME)){e.preventDefault();setDropId(s.id);}}} onDragLeave={()=>setDropId(null)} onDrop={e=>{e.preventDefault();setDropId(null);if(adding)return;const id=e.dataTransfer.getData(VOCAL_LINE_MIME);if(id){setSelected([s.id]);assign(id,s);}}}>
        <span>{labels.get(s.id)}</span><span className={`${styles.edge} ${styles.begin}`} onPointerDown={e=>{if(!adding)begin(e,s,'beginMs');}}/><span className={`${styles.edge} ${styles.end}`} onPointerDown={e=>{if(!adding)begin(e,s,'endMs');}}/>
      </button>;})}
      {preview&&drag?.side==='new'&&<span className={styles.newRange} style={{left:`${pct(preview.beginMs)}%`,width:`${pct(preview.endMs)-pct(preview.beginMs)}%`}}/>}
      {props.positionMs>=startMs&&props.positionMs<=endMs&&<span style={{position:'absolute',left:`${pct(props.positionMs)}%`,top:0,bottom:0,borderLeft:'1px solid #e54848',pointerEvents:'none'}}/>}
    </div></div>}
    {menu&&createPortal(<div role="menu" className={styles.menu} style={{left:Math.min(menu.x,window.innerWidth-170),top:Math.min(menu.y,window.innerHeight-130)}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(null);}}><button autoFocus role="menuitem" data-role="inline" disabled={adding||!active||!props.selectedLineId} onClick={()=>assign(props.selectedLineId,active)}>分配给选中行</button><button role="menuitem" data-role="inline" disabled={selected.length<2} onClick={()=>operate('merge')}>合并选中片段</button><button role="menuitem" data-role="danger" onClick={()=>operate('delete')}>删除选中片段</button></div>,document.body)}
  </div>;
}
