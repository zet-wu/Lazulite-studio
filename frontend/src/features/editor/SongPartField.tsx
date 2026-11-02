import { useMessageText } from '../../shared/useMessageText';
import { message } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../shared/Controls';
import { useEffect, useId, useRef, useState } from 'react';
import type { LyricDocument, LyricLine } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';

export function SongPartField({ document, lines, apply }: { document: LyricDocument; lines: LyricLine[]; apply: (command: LyricCommand) => boolean }) {
  useTranslation();
  const editable=lines.filter(line=>!line.backgroundOf);
  const values=new Set(editable.map(line=>line.songPart??''));
  const mixed=values.size>1, value=values.size===1?[...values][0]:'';
  const identity=JSON.stringify(editable.map(line=>[line.id,line.songPart]));
  const [draft,setDraft]=useState(value), [error,setError]=useMessageText('');
  const dirty=useRef(false), composing=useRef(false), input=useRef<HTMLInputElement>(null);
  const list=useId();
  useEffect(()=>{setDraft(value);dirty.current=false;setError('');},[identity,value]);
  const submit=(next=draft)=>{
    if(mixed||composing.current||!dirty.current)return;
    if(apply({type:'set-song-part',lineIds:editable.map(line=>line.id),value:next.trim()?next:null})){dirty.current=false;setError('');}
    else setError(message('songPart.failed'));
  };
  if(!editable.length) {
    const parent=document.lines.find(line=>line.id===lines[0]?.backgroundOf);
    return <label>{t('songPart.label')}<input aria-label={t('songPart.label')} readOnly value={parent?.songPart??''}/><small>{t('songPart.inherited')}</small></label>;
  }
  const options=[...new Set(['Verse','Chorus','Intro','Bridge','Outro',...document.lines.flatMap(line=>line.songPart?[line.songPart]:[])])];
  return <div><div style={{display:'flex',alignItems:'center',gap:4}}><label style={{flex:1,minWidth:0}}>{t('songPart.label')}<input ref={input} aria-label={t('songPart.label')} aria-invalid={!!error} readOnly={mixed} list={mixed?undefined:list} value={mixed?t('common.multipleValues'):draft} placeholder={mixed?t('common.multipleValues'):t('common.unset')} onChange={event=>{dirty.current=true;setDraft(event.target.value);}} onBlur={()=>submit()} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={event=>{composing.current=false;if(input.current!==globalThis.document.activeElement)submit(event.currentTarget.value);}} onKeyDown={event=>{
    if(mixed||composing.current||event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
    if(event.key==='Escape'){event.stopPropagation();dirty.current=false;setDraft(value);setError('');event.currentTarget.blur();}
  }}/></label><datalist id={list}>{options.map(option=><option key={option} value={option}/>)}</datalist>
    {mixed&&<IconButton icon="trash" label={t('songPart.clear')} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(composing.current)return;if(apply({type:'set-song-part',lineIds:editable.map(line=>line.id),value:null})){dirty.current=false;setDraft('');setError('');input.current?.focus();}}}/>}
    </div>{lines.length>1&&<small>{t(lines.length>editable.length?'songPart.selectedWithBackground':'songPart.selected',{count:editable.length})}</small>}
    {error&&<small role="alert">{error}</small>}
  </div>;
}

const t=i18n.t.bind(i18n);
