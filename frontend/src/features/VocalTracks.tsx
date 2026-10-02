import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vocalApi } from '../adapters/http/client';
import { packIntervals } from '../domain/pack-intervals';
import { editSegments } from '../domain/vocal-editing';
import type { Acoustics, VocalSegment } from '../domain/project-document';
import styles from './vocal.module.css';
type Props = { projectId: string; acoustics: Acoustics; startMs: number; endMs: number; durationMs: number; positionMs: number; selectedLineId: string | null; apply: (acoustics: Acoustics) => void; assign: (lineId: string, segment: VocalSegment) => void; pause: () => void };
type Drag = { segment?: VocalSegment; side: 'move'|'beginMs'|'endMs'|'new'; x: number; now: number; width: number; left: number; document: Acoustics };
export const VOCAL_LINE_MIME = 'application/x-studio-vocal-line';
export function VocalTracks(props: Props) {
  const { acoustics, startMs, endMs, durationMs } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [showEnergy,setShowEnergy] = useState(true);
  const [showSegments,setShowSegments] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
  const [dropId,setDropId] = useState<string | null>(null);
  const span = Math.max(1,endMs-startMs);
  const visible = acoustics.segments.filter(s=>s.endMs>startMs && s.beginMs<endMs);
  const layout = useMemo(()=>packIntervals(visible.map(s=>({key:s.id,...s}))),[acoustics,startMs,endMs]);
  const frozen = useRef(layout); if (!drag) frozen.current = layout;
  const energy = useQuery({queryKey:['vocal-energy',props.projectId,acoustics.analysisId,startMs,endMs],queryFn:({signal})=>vocalApi.energy(props.projectId,acoustics.analysisId!,startMs,endMs,signal),enabled:showEnergy && !!acoustics.analysisId && endMs>startMs,staleTime:60000});
  const cancel = () => { dragRef.current=null; setDrag(null); setAdding(false); setMenu(null); if(adding)requestAnimationFrame(()=>addButton.current?.focus()); };
  useEffect(()=>{
    const key = (e:KeyboardEvent)=>{if(e.key==='Escape'&&(dragRef.current||menu||adding)){ e.preventDefault(); cancel(); }};
    window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key);
  },[adding,menu]);
  useEffect(()=>{if(dragRef.current && dragRef.current.document!==acoustics){dragRef.current=null;setDrag(null);}},[acoustics]);
  useEffect(()=>{
    document.body.classList.toggle('vocal-adding',adding);
    if(adding) cancelButton.current?.focus();
    const guard=(e:KeyboardEvent)=>{
      if(!adding)return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();addButton.current?.focus();}
      else if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();cancelButton.current?.focus();}
      else if(e.target!==cancelButton.current || e.ctrlKey || e.metaKey){e.preventDefault();e.stopImmediatePropagation();}
    };
    window.addEventListener('keydown',guard,true);
    return()=>{document.body.classList.remove('vocal-adding');window.removeEventListener('keydown',guard,true);};
  },[adding]);
  const candidate = (d:Drag): VocalSegment => {
    const delta=Math.round((d.now-d.x)/d.width*span);
    if(d.side==='new') {
      const a=Math.max(0,Math.min(durationMs,Math.round(startMs+(d.x-d.left)/d.width*span)));
      const b=Math.max(0,Math.min(durationMs,Math.round(startMs+(d.now-d.left)/d.width*span)));
      return {id:'preview',beginMs:Math.min(a,b),endMs:Math.max(a,b)};
    }
    const s=d.segment!;
    if(d.side==='move'){const shift=Math.max(-s.beginMs,Math.min(durationMs-s.endMs,delta));return {...s,beginMs:s.beginMs+shift,endMs:s.endMs+shift};}
    return {...s,[d.side]:Math.max(d.side==='beginMs'?0:s.beginMs+1,Math.min(d.side==='beginMs'?s.endMs-1:durationMs,s[d.side]+delta))};
  };
  const begin = (e:PointerEvent<HTMLElement>,segment?:VocalSegment,side:Drag['side']='new')=>{
    if(e.button!==0 || (!segment && !adding))return;
    e.preventDefault(); e.stopPropagation();
    if(segment && (e.ctrlKey||e.metaKey||e.shiftKey)) {
      const sorted=[...acoustics.segments].sort((a,b)=>a.beginMs-b.beginMs||a.endMs-b.endMs||a.id.localeCompare(b.id));
      if(e.shiftKey&&selected.length){const a=sorted.findIndex(s=>s.id===selected.at(-1)),b=sorted.findIndex(s=>s.id===segment.id);setSelected(sorted.slice(Math.min(a,b),Math.max(a,b)+1).map(s=>s.id));}
      else setSelected(selected.includes(segment.id)?selected.filter(id=>id!==segment.id):[...selected,segment.id]);return;
    }
    if(segment)setSelected([segment.id]);
    const lane=e.currentTarget.closest('[data-vocal-lane]')??e.currentTarget;
    const box=lane.getBoundingClientRect();
    const next={segment,side,x:e.clientX,now:e.clientX,width:box.width,left:box.left,document:acoustics};
    dragRef.current=next;setDrag(next);e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move=(e:PointerEvent<HTMLElement>)=>{if(dragRef.current){const next={...dragRef.current,now:e.clientX};dragRef.current=next;setDrag(next);}};
  const finish=()=>{
    const d=dragRef.current;dragRef.current=null;setDrag(null);if(!d)return;
    if(d.document!==acoustics)return;
    const next=candidate(d);
    if(d.side==='new'){setAdding(false);requestAnimationFrame(()=>addButton.current?.focus());if(next.beginMs===next.endMs)return;next.id=crypto.randomUUID();}
    else if(next.beginMs===d.segment!.beginMs&&next.endMs===d.segment!.endMs)return;
    try{props.apply(editSegments(acoustics,{type:'put',segment:next},durationMs));setSelected([next.id]);setError('');}catch(e){setError((e as Error).message);}
  };
  const operate=(type:'merge'|'delete')=>{try{const next=editSegments(acoustics,{type,ids:selected},durationMs);props.apply(next);setSelected(type==='merge'?next.segments.filter(s=>selected.includes(s.id)).map(s=>s.id):[]);setError('');}catch(e){setError((e as Error).message);}setMenu(null);};
  const assign=(lineId:string|null,segment:VocalSegment|undefined)=>{if(!lineId||!segment)return;try{props.assign(lineId,segment);setError('');}catch(e){setError((e as Error).message);}setMenu(null);};
  const active=selected.length===1?acoustics.segments.find(s=>s.id===selected[0]):undefined;
  const preview=drag?candidate(drag):null;
  const pct=(time:number)=>(time-startMs)/span*100;
  return <div className={adding?styles.adding:undefined} data-vocal-tracks>
    {adding && createPortal(<div className={styles.veil} onPointerDown={e=>{e.preventDefault();e.stopPropagation();}}/>,document.body)}
    <div className={styles.segmentTools}><strong>人声片段</strong><label><input type="checkbox" checked={showEnergy} disabled={adding} onChange={e=>setShowEnergy(e.target.checked)}/>能量</label><label><input type="checkbox" checked={showSegments} disabled={adding} onChange={e=>setShowSegments(e.target.checked)}/>片段</label><button data-role="secondary" ref={addButton} disabled={adding} aria-label="新增人声片段" onClick={()=>{props.pause();setShowSegments(true);setAdding(true);setMenu(null);}}>＋</button><button data-role="primary" disabled={adding||!active||!props.selectedLineId} onClick={()=>assign(props.selectedLineId,active)}>分配</button>{adding&&<><span>拖动框选新增片段，Esc 取消</span><button data-role="secondary" ref={cancelButton} onClick={()=>{cancel();addButton.current?.focus();}}>取消新增</button></>}</div>
    {error&&<p role="alert">{error}</p>}
    {showEnergy && <div className={styles.segmentRow} style={adding?{opacity:.25,filter:'blur(2px)'}:undefined}><small>能量</small>{energy.isLoading?<span role="status">能量加载中…</span>:energy.isError?<button data-role="secondary" onClick={()=>void energy.refetch()}>能量加载失败 · 重试</button>:<svg className={styles.energy} viewBox="0 0 1000 55" preserveAspectRatio="none" aria-label="人声能量"><polyline fill="none" stroke="currentColor" strokeWidth="1" points={energy.data?.values.map((v,i)=>`${pct(energy.data!.start_ms+i*energy.data!.step_ms)*10},${54-Math.min(1,v)*52}`).join(' ')??''}/></svg>}</div>}
    {showSegments && <div className={styles.segmentRow}><small>片段</small><div data-vocal-lane className={styles.lane} style={{height:Math.max(1,frozen.current.laneCount)*34+6}} onPointerDown={e=>begin(e)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(dragRef.current?.side==='new')setAdding(false);dragRef.current=null;setDrag(null);}}>
      {visible.map(s=>{const p=preview&&drag?.segment?.id===s.id?preview:s;return <button data-role="secondary" key={s.id} className={styles.segment} data-segment-id={s.id} aria-label={`人声片段 ${s.beginMs}–${s.endMs} 毫秒`} aria-pressed={selected.includes(s.id)} style={{left:`${Math.max(0,pct(p.beginMs))}%`,width:`${Math.min(100,pct(p.endMs))-Math.max(0,pct(p.beginMs))}%`,top:(frozen.current.lanes.get(s.id)??0)*34+3,outline:dropId===s.id?'3px solid var(--primary, #3367ab)':undefined}} onPointerDown={e=>{if(!adding)begin(e,s,'move');}} onClick={e=>{if(e.detail===0)setSelected([s.id]);}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setSelected([s.id]);const r=e.currentTarget.getBoundingClientRect();setMenu({x:r.left,y:r.bottom});}}} onContextMenu={e=>{e.preventDefault();if(adding)return;if(!selected.includes(s.id))setSelected([s.id]);setMenu({x:e.clientX,y:e.clientY});}} onDragOver={e=>{if(!adding&&e.dataTransfer.types.includes(VOCAL_LINE_MIME)){e.preventDefault();setDropId(s.id);}}} onDragLeave={()=>setDropId(null)} onDrop={e=>{e.preventDefault();setDropId(null);if(adding)return;const id=e.dataTransfer.getData(VOCAL_LINE_MIME);if(id){setSelected([s.id]);assign(id,s);}}}>
        <span>{(p.beginMs/1000).toFixed(2)}–{(p.endMs/1000).toFixed(2)}</span><span className={`${styles.edge} ${styles.begin}`} onPointerDown={e=>{if(!adding)begin(e,s,'beginMs');}}/><span className={`${styles.edge} ${styles.end}`} onPointerDown={e=>{if(!adding)begin(e,s,'endMs');}}/>
      </button>;})}
      {preview&&drag?.side==='new'&&<span className={styles.newRange} style={{left:`${pct(preview.beginMs)}%`,width:`${pct(preview.endMs)-pct(preview.beginMs)}%`}}/>}
      {props.positionMs>=startMs&&props.positionMs<=endMs&&<span style={{position:'absolute',left:`${pct(props.positionMs)}%`,top:0,bottom:0,borderLeft:'1px solid #e54848',pointerEvents:'none'}}/>}
    </div></div>}
    {menu&&createPortal(<div role="menu" className={styles.menu} style={{left:Math.min(menu.x,window.innerWidth-170),top:Math.min(menu.y,window.innerHeight-130)}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(null);}}><button autoFocus role="menuitem" data-role="inline" disabled={adding||!active||!props.selectedLineId} onClick={()=>assign(props.selectedLineId,active)}>分配给选中行</button><button role="menuitem" data-role="inline" disabled={selected.length<2} onClick={()=>operate('merge')}>合并选中片段</button><button role="menuitem" data-role="danger" onClick={()=>operate('delete')}>删除选中片段</button></div>,document.body)}
  </div>;
}
