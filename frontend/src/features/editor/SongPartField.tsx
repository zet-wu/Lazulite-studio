import { useEffect, useId, useRef, useState } from 'react';
import type { LyricDocument, LyricLine } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';

export function SongPartField({ document, lines, apply }: { document: LyricDocument; lines: LyricLine[]; apply: (command: LyricCommand) => boolean }) {
  const editable=lines.filter(line=>!line.backgroundOf);
  const values=new Set(editable.map(line=>line.songPart??''));
  const mixed=values.size>1, value=values.size===1?[...values][0]:'';
  const identity=JSON.stringify(editable.map(line=>[line.id,line.songPart]));
  const [draft,setDraft]=useState(value), [error,setError]=useState('');
  const dirty=useRef(false), composing=useRef(false), input=useRef<HTMLInputElement>(null);
  const list=useId();
  useEffect(()=>{setDraft(value);dirty.current=false;setError('');},[identity,value]);
  const submit=(next=draft)=>{
    if(composing.current||!dirty.current)return;
    if(apply({type:'set-song-part',lineIds:editable.map(line=>line.id),value:next||null})){dirty.current=false;setError('');}
    else setError('段落提交失败，草稿已保留');
  };
  if(!editable.length) {
    const parent=document.lines.find(line=>line.id===lines[0]?.backgroundOf);
    return <label>歌曲段落<input aria-label="歌曲段落" readOnly value={parent?.songPart??''}/><small>背景继承所属主行段落，只读</small></label>;
  }
  const options=[...new Set(['Verse','Chorus','Intro','Bridge','Outro',...document.lines.flatMap(line=>line.songPart?[line.songPart]:[])])];
  return <div><label>歌曲段落<input ref={input} aria-label="歌曲段落" aria-invalid={!!error} list={list} value={draft} placeholder={mixed?'多个值':'未设置'} onChange={event=>{dirty.current=true;setDraft(event.target.value);}} onBlur={()=>submit()} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={event=>{composing.current=false;if(input.current!==globalThis.document.activeElement)submit(event.currentTarget.value);}} onKeyDown={event=>{
    if(composing.current||event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
    if(event.key==='Escape'){event.stopPropagation();dirty.current=false;setDraft(value);setError('');event.currentTarget.blur();}
  }}/></label><datalist id={list}>{options.map(option=><option key={option} value={option}/>)}</datalist>
    <button data-role="inline" disabled={!draft&&!mixed&&!value} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(composing.current)return;dirty.current=true;setDraft('');submit('');}}>清除歌曲段落</button>
    {lines.length>1&&<small>编辑明确选中的 {editable.length} 条主行{lines.length>editable.length?'，背景不单独设置':''}</small>}
    {error&&<small role="alert">{error}</small>}
  </div>;
}
