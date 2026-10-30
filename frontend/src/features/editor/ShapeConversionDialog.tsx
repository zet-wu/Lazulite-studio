import { useEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { analyzeShapes } from '../../adapters/http/shapes';
import { shapeCommand, shapeTargets, validShapeValue, type ShapeCell, type ShapeRow, type ShapeTarget } from '../../domain/shape-conversion';
import type { LyricDocument } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { IconButton } from '../../shared/Controls';
import { SettingsDialog } from './SettingsDialog';
import { ReadingPair } from './ReadingPreview';
import styles from './semantic-editor.module.css';
import shapes from './shape-conversion.module.css';

function ShapeInput({cell,disabled,change,focus,composition}:{cell:ShapeCell;disabled:boolean;change:(value:string,edited:boolean)=>void;focus:(active:boolean)=>void;composition:(active:boolean)=>void}) {
  const initial=useRef({value:cell.value,edited:cell.edited}),composing=useRef(false);
  const invalid=!validShapeValue(cell.value),attention=!cell.edited&&cell.status!=='known';
  return <input aria-label={`${cell.original}的目标字`} aria-invalid={invalid||undefined} className={`${styles.romanPreviewInput} ${attention?shapes.attention:''}`} value={cell.value} disabled={disabled}
    onChange={event=>change(event.target.value,true)} onFocus={()=>{initial.current={value:cell.value,edited:cell.edited};focus(true);}} onBlur={()=>focus(false)}
    onCompositionStart={()=>{composing.current=true;composition(true);}} onCompositionEnd={()=>{composing.current=false;composition(false);}}
    onKeyDown={event=>{if(composing.current||event.nativeEvent.isComposing){event.stopPropagation();return;}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();change(initial.current.value,initial.current.edited);}if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>;
}

export function ShapeConversionDialog({document,lineIds,apply,close}:{document:LyricDocument;lineIds:string[];apply:(command:LyricCommand)=>boolean;close:()=>void}) {
  const [source]=useState(document),[ids]=useState(lineIds),[target,setTarget]=useState<ShapeTarget>('simplified');
  const [rows,setRows]=useState<ShapeRow[]>([]),[pending,setPending]=useState(true),[error,setError]=useState(''),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
  const [composing,setComposing]=useState(false),[active,setActive]=useState<string|null>(null);
  const edited=useRef(new Map<string,string>()),abort=useRef<AbortController|null>(null),scroll=useRef<HTMLDivElement>(null);
  const stale=source!==document;
  useEffect(()=>{
    if(stale)return;
    const controller=new AbortController();abort.current=controller;setPending(true);setReady(false);setError('');
    void analyzeShapes(source,ids,target,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      setRows(result.map(row=>({...row,cells:row.cells.map(cell=>edited.current.has(cell.key)?{...cell,value:edited.current.get(cell.key)!,edited:true}:cell)})));setReady(true);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
    return()=>controller.abort();
  },[source,ids,target,attempt,stale]);
  const virtual=rows.length>80;
  const virtualizer=useVirtualizer({count:virtual?rows.length:0,getScrollElement:()=>scroll.current,estimateSize:()=>130,overscan:3,getItemKey:index=>rows[index].id,
    rangeExtractor:range=>{const all=defaultRangeExtractor(range),index=rows.findIndex(row=>row.id===active);return index<0||all.includes(index)?all:[...all,index].sort((a,b)=>a-b);}});
  const shown=virtual?virtualizer.getVirtualItems().map(item=>({row:rows[item.index],item})):rows.map(row=>({row,item:null}));
  const invalid=rows.some(row=>row.cells.some(cell=>cell.editable&&!validShapeValue(cell.value)));
  const change=(key:string,value:string,touched:boolean)=>{
    if(touched)edited.current.set(key,value);else edited.current.delete(key);
    setRows(current=>current.map(row=>({...row,cells:row.cells.map(cell=>cell.key===key?{...cell,value,edited:touched}:cell)})));
  };
  const submit=()=>{
    if(stale||pending||!ready||composing||invalid)return;
    try { if(apply(shapeCommand(document,source,rows)))close(); } catch(cause){setError((cause as Error).message);}
  };
  return <SettingsDialog title="简繁／中日汉字转换" close={()=>{if(!composing)close();}} actions={<><button data-role="secondary" disabled={composing} onClick={close}>取消</button><button data-role="primary" disabled={stale||pending||!ready||composing||invalid} onClick={submit}>应用</button></>}>
    <div className={styles.rubyGeneration}>
      <div className={shapes.toolbar}><label>转换目标<select data-initial-focus aria-label="转换目标" value={target} disabled={stale||composing} onChange={event=>{abort.current?.abort();edited.current.clear();setRows([]);setReady(false);setPending(true);setTarget(event.target.value as ShapeTarget);}}>{Object.entries(shapeTargets).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <IconButton icon="refresh" label="重新分析字形" data-role="secondary" disabled={stale||pending||composing} onClick={()=>{setReady(false);setPending(true);setAttempt(value=>value+1);}}/></div>
      <p>红框结果请核对，留空保留原字</p>
      {pending&&<p role="status">正在分析字形…</p>}{error&&<p role="alert">{error}</p>}{stale&&<p role="alert">源文档已变化，请重新打开转换。</p>}{invalid&&<p role="alert">每格只能输入一个完整字素，或留空保留原字。</p>}
      <div ref={scroll} className={`${styles.rubyGenerationRows} ${virtual?styles.rubyGenerationRowsVirtual:''}`}><div style={virtual?{height:virtualizer.getTotalSize(),position:'relative'}:undefined}>
        {shown.map(({row,item})=><section key={row.id} data-index={item?.index} ref={item?virtualizer.measureElement:undefined} style={item?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
          <small>{source.lines.findIndex(line=>line.id===row.id)+1} 行</small><div className={styles.japaneseRubyBlocks}>{row.cells.map(cell=><ReadingPair key={cell.key} text={cell.original}>
            {cell.editable?<ShapeInput cell={cell} disabled={stale||pending||!ready} change={(value,touched)=>change(cell.key,value,touched)} focus={value=>setActive(value?row.id:null)} composition={setComposing}/>:cell.status==='failed'?<span className={shapes.attention} aria-label="无法对应原词字位">　</span>:null}
          </ReadingPair>)}</div>
        </section>)}
      </div></div>
    </div>
  </SettingsDialog>;
}
