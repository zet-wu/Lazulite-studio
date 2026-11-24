import {createPortal} from 'react-dom';
import { useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react';
import { measureTextWidth } from '../../shared/measure-text';
import styles from './semantic-editor.module.css';
import candidatesStyle from './reading-candidates.module.css';

// Both reading workflows share presentation; callers retain their input semantics.
export function ReadingPair({text, status, hint, children}:{text:string;status?:string;hint?:string;children?:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const container=ref.current!, row=container.parentElement!;
  const resize=()=>{
   const body=container.querySelector<HTMLElement>('[data-reading-body]')!;
   const label=container.querySelector<HTMLElement>('[data-reading-status]');
   const inputs=Array.from(container.querySelectorAll('input'));
   const widths=inputs.map(input=>Math.max(40,measureTextWidth(input,input.value,true)));
   const reading=widths.reduce((sum,width)=>sum+width,0)+Math.max(0,inputs.length-1)*4;
   const width=Math.min(row.clientWidth,640,Math.max(40,reading,measureTextWidth(body,text),label?measureTextWidth(label,label.textContent??''):0));
   container.style.width=width+'px';
   inputs.forEach((input,i)=>{input.style.width=inputs.length===1?'100%':Math.min(width,widths[i])+'px';});
  };
  resize();const observer=new ResizeObserver(resize);observer.observe(row);
  let alive=true;void document.fonts?.ready.then(()=>{if(alive)resize();});
  return()=>{alive=false;observer.disconnect();};
 });
 return <div ref={ref} className={`${styles.japaneseRubyBlock} ${hint?styles.readingHint:''}`} data-tooltip={hint} title={hint} tabIndex={hint&&!children?0:undefined} aria-description={hint}>
  {status&&<small data-reading-status>{status}</small>}
  {children}
  <div data-reading-body className={styles.japaneseRubyText}>{text}</div>
 </div>;
}

export function ReadingInput({value,label,hint,disabled,needsReview=false,hasAlternatives=false,change,focus,composition,alternatives,alternativeIndex,choose}:{
 alternatives?:string[];alternativeIndex?:number;choose?:(index:number)=>void;
 value:string;label:string;hint?:string;needsReview?:boolean;hasAlternatives?:boolean;disabled?:boolean;change:(value:string)=>void;focus:(active:boolean)=>void;composition:(active:boolean)=>void;
}) {
 const start=useRef(value),composing=useRef(false);
 const [open,setOpen]=useState(false),[active,setActive]=useState(0);
 const listId=useId(), inputRef=useRef<HTMLInputElement>(null);
 const [position,setPosition]=useState({left:0,top:0,bottom:undefined as number|undefined,minWidth:0});
 useLayoutEffect(()=>{
   if(!open)return;
   const locate=()=>{const rect=inputRef.current!.getBoundingClientRect();const below=window.innerHeight-rect.bottom;setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-320)),top:below>=150?rect.bottom+2:0,bottom:below>=150?undefined:window.innerHeight-rect.top+2,minWidth:Math.round(rect.width)});};
   locate();window.addEventListener('resize',locate);window.addEventListener('scroll',locate,true);
   return()=>{window.removeEventListener('resize',locate);window.removeEventListener('scroll',locate,true);};
 },[open]);
 const options=alternatives??[];
 const available=options.length>1;
 const missing=!value.trim()||needsReview;
 const secondary=!missing&&hasAlternatives;
 const pick=(index:number)=>{choose?.(index);setOpen(false);};
 const openList=()=>{if(!available)return;setActive(Math.max(0,alternativeIndex??options.indexOf(value)));setOpen(true);};
 const input=<input ref={inputRef} title={hint||value||undefined} aria-label={label} aria-description={hint} data-status={missing?'missing':secondary?'alternatives':undefined}
  role={available?'combobox':undefined} aria-autocomplete={available?'list':undefined} aria-expanded={available?open:undefined} aria-controls={open?listId:undefined} aria-activedescendant={open?`${listId}-${active}`:undefined}
  name={label} autoComplete="off" spellCheck={false}
  className={`${styles.romanPreviewInput} ${missing?styles.japaneseRubyMissing:secondary?styles.japaneseRubyAlternative:''}`} value={value} disabled={disabled}
  onChange={e=>{setOpen(false);change(e.target.value);}} onClick={()=>{if(!open)openList();}} onFocus={()=>{start.current=value;focus(true);openList();}} onBlur={()=>{setOpen(false);focus(false);}}
  onCompositionStart={()=>{composing.current=true;setOpen(false);composition(true);}} onCompositionEnd={()=>{composing.current=false;composition(false);}}
  onKeyDown={e=>{
    if(composing.current||e.nativeEvent.isComposing){e.stopPropagation();return;}
    if(available&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();e.stopPropagation();setOpen(true);setActive(i=>(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length);return;}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(open)setOpen(false);else change(start.current);}
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(open)pick(active);else e.currentTarget.blur();}
  }}/>;
 if(!available)return input;
 return <span className={candidatesStyle.anchor}>{input}{open&&createPortal(<span id={listId} role="listbox" aria-label={label} className={candidatesStyle.list} style={{left:position.left,top:position.bottom===undefined?position.top:undefined,bottom:position.bottom,minWidth:position.minWidth}}>
   {options.map((option,index)=><button type="button" data-role="inline" id={`${listId}-${index}`} role="option" aria-selected={index===active} key={index} tabIndex={-1} onPointerDown={e=>e.preventDefault()} onClick={()=>pick(index)}>{option}</button>)}
 </span>,inputRef.current?.closest('[role="dialog"]')??document.body)}</span>;
}
