import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { analyzeDictionary, listDictionaries, type DictionaryInfo } from '../../adapters/http/dictionaries';
import { preferences } from '../../adapters/preferences';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { dictionaryBlockApplies, dictionaryRubyCommand, proposeDictionaryRuby, type DictionaryRow } from '../../domain/dictionary-ruby';
import { IconButton } from '../../shared/Controls';
import { SettingsDialog } from './SettingsDialog';
import { dictionaryLabel } from './DictionaryManager';
import styles from './dictionary-ruby.module.css';
import preview from './semantic-editor.module.css';
import { ReadingInput, ReadingPair } from './ReadingPreview';

export function DictionaryRubyDialog({document,lineIds,apply,close}:{document:LyricDocument;lineIds:string[];apply:(c:LyricCommand)=>boolean;close:()=>void}) {
  useTranslation();
  const [source]=useState(document),[ids]=useState(lineIds);
  const [items,setItems]=useState<DictionaryInfo[]>([]),[selected,setSelected]=useState('');
  const [rows,setRows]=useState<DictionaryRow[]>([]),[pending,setPending]=useState(false),[error,setError]=useMessageText('');
  const [phase,setPhase]=useState<'loading'|'analyzing'>('loading');
  const [attempt,setAttempt]=useState(0),[merge,setMerge]=useState(false);
  const [composing,setComposing]=useState(false),[active,setActive]=useState<string|null>(null);
  const edited=useRef(new Map<string,{units:string[];reviewed:boolean[]}>()), scroll=useRef<HTMLDivElement>(null);
  const abort=useRef<AbortController|null>(null), selection=useRef('');
  const stale=source!==document;
  useEffect(()=>{
    const controller=new AbortController();
    void listDictionaries(controller.signal).then(result=>{
      setItems(result.dictionaries);setError(result.errors.join(t('notice.separator')));
      const id=preferences.getItem('studio:reading-dictionary');
      const found=result.dictionaries.find(item=>item.id===id&&!item.error);
      const next=found?.instance??'';
      if(next!==selection.current){abort.current?.abort();edited.current.clear();setRows([]);setPending(!!next);setSelected(next);selection.current=next;}
      if(id&&!found)setError(describeMessage('dictionary.unavailable'));
    }).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));});
    return()=>controller.abort();
  },[]);
  useEffect(()=>{
    const item=items.find(i=>i.instance===selected);
    if(!item||stale)return;
    const controller=new AbortController();abort.current=controller;setPending(true);setPhase('loading');setError('');
    void analyzeDictionary(item.id,item.instance,source.lines.filter(l=>ids.includes(l.id)).map(l=>({id:l.id,text:lineText(l)})),controller.signal,value=>{if(!controller.signal.aborted)setPhase(value);}).then(result=>{
      if(controller.signal.aborted)return;
      setRows(proposeDictionaryRuby(source,ids,result.ranges).map(row=>({...row,blocks:row.blocks.map(block=>{
        const values=edited.current.get(block.key);
        return values&&values.units.length===block.units.length?{...block,units:[...values.units],reviewed:[...values.reviewed]}:block;
      })})));
    }).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
    return()=>controller.abort();
  },[selected,items,source,ids,attempt,stale]);
  const virtual=rows.length>80;
  const virtualizer=useVirtualizer({count:virtual?rows.length:0,getScrollElement:()=>scroll.current,estimateSize:()=>150,overscan:3,getItemKey:i=>rows[i].lineId,
    rangeExtractor:range=>{const all=defaultRangeExtractor(range),i=rows.findIndex(r=>r.lineId===active);return i<0||all.includes(i)?all:[...all,i].sort((a,b)=>a-b);}});
  const shown=virtual?virtualizer.getVirtualItems().map(item=>({row:rows[item.index],item})):rows.map(row=>({row,item:null}));
  const changed=rows.some(r=>r.blocks.some(b=>dictionaryBlockApplies(b,merge)));
  const change=(key:string,index:number,value:string)=>setRows(previous=>previous.map(row=>({...row,blocks:row.blocks.map(block=>{
    if(block.key!==key)return block;
    const units=block.units.map((u,i)=>i===index?value:u);
    const reviewed=block.reviewed.map((done,i)=>i===index&&value!==block.units[i]?!!value.trim():done);
    edited.current.set(key,{units,reviewed});return {...block,units,reviewed};
  })})));
  const submit=()=>{if(stale||pending||composing)return;try{if(apply(dictionaryRubyCommand(document,source,rows,merge)))close();}catch(e){setError(errorMessage(e));}};
  return <SettingsDialog title={t('editor.dictionaryRuby')} subtitle={t('editor.lineCount',{count:ids.length})} close={()=>{if(!composing)close();}}
    actions={<><button data-dialog-close data-role="secondary" disabled={composing} onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={composing||pending||stale||!changed} onClick={submit}>{t('common.apply')}</button></>}>
    <div className={preview.rubyGeneration}>
    <div className={styles.toolbar}>
      <label>{t('dictionary.label')}<select aria-label={t('dictionary.label')} value={selected} disabled={composing||stale} onChange={e=>{
        const value=e.target.value;abort.current?.abort();selection.current=value;edited.current.clear();setRows([]);setPending(!!value);setSelected(value);
        const item=items.find(i=>i.instance===value);if(item)preferences.setItem('studio:reading-dictionary',item.id);
      }}><option value="">{t('dictionary.choose')}</option>{items.map(i=><option key={i.instance} value={i.instance} disabled={!!i.error}>{dictionaryLabel(i)}</option>)}</select></label>
      <IconButton icon="refresh" label={t('dictionary.regenerate')} data-role="secondary" disabled={!selected||pending||composing||stale} onClick={()=>setAttempt(a=>a+1)}/>
    </div>
    {!items.length&&<p>{t('dictionary.importRequired')}</p>}
    {rows.some(r=>r.blocks.some(b=>b.merge))&&<label><input type="checkbox" checked={merge} disabled={composing||stale} onChange={e=>setMerge(e.target.checked)}/>{t('dictionary.allowMerge')}</label>}
    {pending&&<p role="status">{phase==='loading'?t('dictionary.loading'):t('dictionary.analyzing')}</p>}
    {error&&<p role="alert">{error}</p>}
    {stale&&<p role="alert">{t('reading.sourceChanged')}</p>}
    <div ref={scroll} className={`${preview.rubyGenerationRows} ${virtual?preview.rubyGenerationRowsVirtual:''}`}>
      <div style={virtual?{height:virtualizer.getTotalSize(),position:'relative'}:undefined}>
        {shown.map(({row,item})=><section key={row.lineId} data-index={item?.index} ref={item?virtualizer.measureElement:undefined}
          style={item?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
          <small>{source.lines.findIndex(l=>l.id===row.lineId)+1} {t('selection.line')}</small>
          <div className={preview.japaneseRubyBlocks}>{row.blocks.map(block=>{
            const editable=!['boundary','unannotated'].includes(block.status);
            const hint=editable?((block.merge&&!merge?t('dictionary.mergeRequired'):'')+t('dictionary.emptyHelp')):undefined;
            return <ReadingPair key={block.key} text={block.base} hint={hint} status={block.existing?t('reading.existing'):block.merge&&dictionaryBlockApplies(block,merge)?t('reading.willMerge'):undefined}>
              {editable&&<div className={styles.units}>{block.units.map((unit,i)=><ReadingInput key={i}
                value={unit} needsReview={block.status==='ambiguous'&&!block.reviewed[i]} label={t('reading.unitReading',{text:block.base,number:i+1})} hint={hint}
                disabled={stale||pending} change={value=>change(block.key,i,value)}
                focus={value=>setActive(value?row.lineId:null)} composition={setComposing}/>)}</div>}
            </ReadingPair>;
          })}</div>
        </section>)}
      </div>
    </div>
    </div>
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
