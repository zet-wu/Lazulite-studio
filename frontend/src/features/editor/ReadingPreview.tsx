import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { measureTextWidth } from '../../shared/measure-text';
import styles from './semantic-editor.module.css';

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

export function ReadingInput({value,label,hint,disabled,change,focus,composition}:{
 value:string;label:string;hint?:string;disabled?:boolean;change:(value:string)=>void;focus:(active:boolean)=>void;composition:(active:boolean)=>void;
}) {
 const start=useRef(value),composing=useRef(false);
 const missing=!value.trim();
 return <input title={hint||value||undefined} aria-label={label} aria-description={hint}
  className={`${styles.romanPreviewInput} ${missing?styles.japaneseRubyMissing:''}`} value={value} disabled={disabled}
  onChange={e=>change(e.target.value)} onFocus={()=>{start.current=value;focus(true);}} onBlur={()=>focus(false)}
  onCompositionStart={()=>{composing.current=true;composition(true);}} onCompositionEnd={()=>{composing.current=false;composition(false);}}
  onKeyDown={e=>{if(composing.current||e.nativeEvent.isComposing){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();change(start.current);}if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>;
}
