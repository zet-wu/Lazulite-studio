import { useEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { analyzeReadings } from '../../adapters/http/reading';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { hasJapaneseRubyChanges, japaneseRubyCommand, proposeJapaneseRuby, type ReadingBlock } from '../../domain/japanese-ruby';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

function ReadingInput({ block, change, focus, composition }: { block: ReadingBlock; change: (value: string) => void; focus: (active: boolean) => void; composition: (active: boolean) => void }) {
 const start = useRef(block.reading), composing = useRef(false);
 const missing = !block.reading.trim();
 return <input aria-label={`${block.text}完整读音`} aria-description={missing ? block.existing ? '清空将保留原注音' : '缺少读音，留空将跳过' : undefined}
  className={`${styles.romanPreviewInput} ${missing ? styles.japaneseRubyMissing : ''}`} value={block.reading}
  style={{ width: `${Math.max(4,Math.min(32,Array.from(block.reading).length+1))}ch` }}
  onChange={e=>change(e.target.value)} onFocus={()=>{start.current=block.reading;focus(true);}} onBlur={()=>focus(false)}
  onCompositionStart={()=>{composing.current=true;composition(true);}} onCompositionEnd={()=>{composing.current=false;composition(false);}}
  onKeyDown={e=>{if(composing.current||e.nativeEvent.isComposing){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();change(start.current);}if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>;
}

export function JapaneseRubyDialog({ document, lineIds, apply, close }: { document: LyricDocument; lineIds: string[]; apply: (command: LyricCommand) => boolean; close: () => void }) {
 const [source] = useState(document), [ids] = useState(lineIds);
 const [rows,setRows] = useState(()=>proposeJapaneseRuby(source,ids,[]));
 const [attempt,setAttempt] = useState(0), [pending,setPending] = useState(true), [error,setError] = useState('');
 const [composing,setComposing] = useState(false), [active,setActive] = useState<string|null>(null);
 const edited = useRef(new Map<string,string>()), scroll = useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const controller=new AbortController();setPending(true);setError('');
  Promise.resolve().then(()=>{if(controller.signal.aborted)return null;return analyzeReadings(source.lines.filter(l=>ids.includes(l.id)).map(l=>({id:l.id,text:lineText(l)})),controller.signal);}).then(result=>{
   if(controller.signal.aborted||!result)return;
   const next=proposeJapaneseRuby(source,ids,result.ranges);
   setRows(previous=>next.map(row=>{
    const old=previous.find(r=>r.lineId===row.lineId);
    const editedWords=new Set(old?.blocks.filter(b=>edited.current.has(b.key)).map(b=>b.wordId));
    const emitted=new Set<string>();
    return {...row,blocks:row.blocks.flatMap(b=>{
     if(!editedWords.has(b.wordId))return [b];
     if(emitted.has(b.wordId))return [];emitted.add(b.wordId);
     return old!.blocks.filter(item=>item.wordId===b.wordId);
    })};
   }));
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'读音生成失败');}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return ()=>controller.abort();
 },[source,ids,attempt]);
 const virtual=rows.length>80;
 const virtualizer=useVirtualizer({count:virtual?rows.length:0,getScrollElement:()=>scroll.current,estimateSize:()=>140,overscan:3,getItemKey:i=>rows[i].lineId,
  rangeExtractor:range=>{const items=defaultRangeExtractor(range),index=rows.findIndex(r=>r.lineId===active);return index<0||items.includes(index)?items:[...items,index].sort((a,b)=>a-b);}});
 const shown=virtual?virtualizer.getVirtualItems().map(item=>({row:rows[item.index],item})):rows.map(row=>({row,item:null}));
 const stale=document!==source, changed=hasJapaneseRubyChanges(rows,source);
 const submit=()=>{if(composing||pending||stale)return;try{if(apply(japaneseRubyCommand(document,source,rows)))close();}catch(cause){setError((cause as Error).message);}};
 return <SettingsDialog title="生成日文注音" subtitle={`${rows.length} 行`} close={()=>{if(!composing)close();}}
  actions={<><button data-role="secondary" onClick={close} disabled={composing}>取消</button><button data-role="primary" onClick={submit} disabled={composing||pending||stale||!changed}>应用</button></>}>
  <div className={styles.rubyGeneration}>
  <p>编辑完整读音；空白项跳过。时间按比例估算，应用后可在时间轴调整。</p>
  {pending&&<p role="status">正在分析日文正文…</p>}{error&&<div role="alert">{error} <button data-role="secondary" disabled={pending||composing} onClick={()=>setAttempt(n=>n+1)}>重试</button></div>}
  {stale&&<p role="alert">源文档已变化，请重新打开生成。</p>}
  <div ref={scroll} className={`${styles.rubyGenerationRows} ${virtual?styles.rubyGenerationRowsVirtual:''}`} data-japanese-rows={rows.length}>
   <div style={virtual?{height:virtualizer.getTotalSize(),position:'relative'}:{display:'grid',gap:12}}>
    {shown.map(({row,item})=><section key={row.lineId} data-reading-row={row.lineId} data-index={item?.index} ref={item?virtualizer.measureElement:undefined}
     style={item?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
     <div className={styles.japaneseRubyLabel}>{row.background?'背景行':'主行'} · {source.lines.findIndex(l=>l.id===row.lineId)+1}</div>
     <div className={styles.japaneseRubyBlocks}>{row.blocks.map(block=><div className={styles.japaneseRubyBlock} key={block.key}>
      {block.editable&&<ReadingInput block={block} composition={setComposing} focus={value=>setActive(value?row.lineId:null)} change={reading=>{
       edited.current.set(block.key,reading);setRows(previous=>previous.map(r=>r.lineId===row.lineId?{...r,blocks:r.blocks.map(b=>b.key===block.key?{...b,reading}:b)}:r));
      }}/>}
      <div className={styles.japaneseRubyText}>{block.text}</div>
      {block.existing&&<small>已有注音</small>}
     </div>)}</div>
    </section>)}
   </div>
  </div>
  </div>
 </SettingsDialog>;
}
