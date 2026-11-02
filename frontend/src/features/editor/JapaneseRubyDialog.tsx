import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../shared/Controls';
import { ReadingInput, ReadingPair } from './ReadingPreview';
import { useEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { analyzeReadings } from '../../adapters/http/reading';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { hasJapaneseRubyChanges, japaneseRubyCommand, proposeJapaneseRuby } from '../../domain/japanese-ruby';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function JapaneseRubyDialog({ document, lineIds, apply, close }: { document: LyricDocument; lineIds: string[]; apply: (command: LyricCommand) => boolean; close: () => void }) {
  useTranslation();
 const [autoMerge,setAutoMerge] = useState(false);
 const [source] = useState(document), [ids] = useState(lineIds);
 const [rows,setRows] = useState(()=>proposeJapaneseRuby(source,ids,[]));
 const [attempt,setAttempt] = useState(0), [pending,setPending] = useState(true), [error,setError] = useMessageText('');
 const [composing,setComposing] = useState(false), [active,setActive] = useState<string|null>(null);
 const edited = useRef(new Map<string,string>()), scroll = useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const controller=new AbortController();setPending(true);setError('');
  Promise.resolve().then(()=>{if(controller.signal.aborted)return null;return analyzeReadings(source.lines.filter(l=>ids.includes(l.id)).map(l=>({id:l.id,text:lineText(l)})),controller.signal);}).then(result=>{
   if(controller.signal.aborted||!result)return;
   const next=proposeJapaneseRuby(source,ids,result.ranges,autoMerge);
   setRows(previous=>next.map(row=>{
    const old=previous.find(r=>r.lineId===row.lineId);
    const editedWords=new Set(old?.blocks.filter(b=>edited.current.has(b.key)).map(b=>b.wordId));
    if(old?.blocks.some(b=>b.spans&&edited.current.has(b.key)) || row.blocks.some(b=>b.spans?.some(span=>editedWords.has(span.wordId)))) return old!;
    const emitted=new Set<string>();
    return {...row,blocks:row.blocks.flatMap(b=>{
     if(!editedWords.has(b.wordId))return [b];
     if(emitted.has(b.wordId))return [];emitted.add(b.wordId);
     return old!.blocks.filter(item=>item.wordId===b.wordId);
    })};
   }));
  }).catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return ()=>controller.abort();
 },[source,ids,attempt,autoMerge]);
 const virtual=rows.length>80;
 const virtualizer=useVirtualizer({count:virtual?rows.length:0,getScrollElement:()=>scroll.current,estimateSize:()=>140,overscan:3,getItemKey:i=>rows[i].lineId,
  rangeExtractor:range=>{const items=defaultRangeExtractor(range),index=rows.findIndex(r=>r.lineId===active);return index<0||items.includes(index)?items:[...items,index].sort((a,b)=>a-b);}});
 const shown=virtual?virtualizer.getVirtualItems().map(item=>({row:rows[item.index],item})):rows.map(row=>({row,item:null}));
 const stale=document!==source, changed=hasJapaneseRubyChanges(rows,source);
 const submit=()=>{if(composing||pending||stale)return;try{if(apply(japaneseRubyCommand(document,source,rows)))close();}catch(cause){setError(errorMessage(cause));}};
 return <SettingsDialog title={t('editor.japaneseRuby')} subtitle={t('editor.lineCount',{count:rows.length})} close={()=>{if(!composing)close();}}
  actions={<><button data-role="secondary" onClick={close} disabled={composing}>{t('common.cancel')}</button><button data-role="primary" onClick={submit} disabled={composing||pending||stale||!changed}>{t('common.apply')}</button></>}>
  <div className={styles.rubyGeneration}>
  <p>{t('reading.emptySkip')}</p>
  <label className={styles.japaneseRubyMerge}><input type="checkbox" checked={autoMerge} disabled={composing||stale} onChange={event=>{
    if(composing)return;
    edited.current.clear();setActive(null);setPending(true);setError('');setRows(proposeJapaneseRuby(source,ids,[]));setAutoMerge(event.target.checked);
  }}/>{t('reading.mergeKanji')}</label>
  {pending&&<p role="status">{t('reading.analyzingJapanese')}</p>}{error&&<div role="alert">{error} <IconButton icon="refresh" label={t('reading.retryJapanese')} data-role="secondary" disabled={pending||composing} onClick={()=>setAttempt(n=>n+1)}/></div>}
  {stale&&<p role="alert">{t('reading.sourceChanged')}</p>}
  <div ref={scroll} className={`${styles.rubyGenerationRows} ${virtual?styles.rubyGenerationRowsVirtual:''}`} data-japanese-rows={rows.length}>
   <div style={virtual?{height:virtualizer.getTotalSize(),position:'relative'}:{display:'grid',gap:12}}>
    {shown.map(({row,item})=><section key={row.lineId} data-reading-row={row.lineId} data-index={item?.index} ref={item?virtualizer.measureElement:undefined}
     style={item?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
     <div className={styles.japaneseRubyLabel}>{row.background?t('reading.backgroundLine'):t('reading.mainLine')} · {source.lines.findIndex(l=>l.id===row.lineId)+1}</div>
     <div className={styles.japaneseRubyBlocks}>{row.blocks.map(block=><ReadingPair text={block.text} status={block.existing?t('reading.existing'):block.spans?t('reading.willMerge'):undefined} key={block.key}>
      {block.editable&&<ReadingInput value={block.reading} label={t('reading.fullReading',{text:block.text})} hint={!block.reading.trim()?(block.existing?t('reading.clearPreserves'):t('reading.missing')):undefined} composition={setComposing} focus={value=>setActive(value?row.lineId:null)} change={reading=>{
       edited.current.set(block.key,reading);setRows(previous=>previous.map(r=>r.lineId===row.lineId?{...r,blocks:r.blocks.map(b=>b.key===block.key?{...b,reading}:b)}:r));
      }}/>}
     </ReadingPair>)}</div>
    </section>)}
   </div>
  </div>
  </div>
 </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
