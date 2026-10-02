import { useEffect, useId, useRef, useState, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './select.css';
/** Native form/label semantics with a shared desktop listbox. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref=useRef<HTMLSelectElement>(null);
  const list=useRef<HTMLDivElement>(null);
  const id=useId();
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const [rect,setRect]=useState({left:0,top:0,width:0,maxHeight:280});
  const options=ref.current?Array.from(ref.current.options):[];
  const close=()=>{setOpen(false);ref.current?.focus();};
  const show=()=>{
    if(props.disabled)return;
    const r=ref.current!.getBoundingClientRect();
    const below=innerHeight-r.bottom-8;
    setRect({left:Math.min(r.left,innerWidth-Math.max(160,r.width)-8),top:below>=160?r.bottom+4:Math.max(8,r.top-284),width:Math.max(160,r.width),maxHeight:below>=160?Math.min(280,below):Math.min(280,r.top-12)});
    setActive(Math.max(0,ref.current!.selectedIndex));setOpen(true);
  };
  const choose=(index:number)=>{
    const select=ref.current!;if(select.options[index]?.disabled)return;
    select.selectedIndex=index;select.dispatchEvent(new Event('change',{bubbles:true}));close();
  };
  useEffect(()=>{
    if(!open)return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});
  },[open,active]);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!list.current?.contains(e.target as Node)&&e.target!==ref.current)setOpen(false);};
    const resize=()=>setOpen(false);
    window.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);};
  },[open]);
  return <><select {...props} ref={ref} className={`studio-select ${props.className??''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} aria-activedescendant={open?`${id}-${active}`:undefined}
    onPointerDown={e=>{props.onPointerDown?.(e);if(e.button===0&&!e.defaultPrevented){e.preventDefault();ref.current?.focus();if(open)close();else show();}}}
    onBlur={e=>{props.onBlur?.(e);setOpen(false);}}
    onKeyDown={e=>{
      props.onKeyDown?.(e);if(e.defaultPrevented)return;
      if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==='Tab'){setOpen(false);return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)){
        e.preventDefault();e.stopPropagation();
        if(!open){show();return;}
        if(e.key==='Enter'||e.key===' '){choose(active);return;}
        const enabled=options.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0);
        const index=enabled.indexOf(active);
        setActive(e.key==='Home'?enabled[0]:e.key==='End'?enabled.at(-1)!:enabled[Math.max(0,Math.min(enabled.length-1,index+(e.key==='ArrowDown'?1:-1)))]??active);
      } else if(open&&e.key.length===1){e.preventDefault();const index=options.findIndex(o=>!o.disabled&&o.text.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));if(index>=0)setActive(index);}
    }}/>{open&&createPortal(<div ref={list} id={id} role="listbox" aria-label={props['aria-label']??ref.current?.labels?.[0]?.textContent??'选项'} className="studio-select-list" style={rect} onPointerDown={e=>e.preventDefault()}>{options.map((o,i)=><div key={i} id={`${id}-${i}`} data-index={i} role="option" aria-selected={o.selected} aria-disabled={o.disabled} data-active={active===i} onPointerMove={()=>{if(!o.disabled)setActive(i);}} onClick={()=>choose(i)}>{o.text}</div>)}</div>,document.body)}</>;
}
