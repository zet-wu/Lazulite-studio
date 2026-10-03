import { useEffect, useLayoutEffect, useId, useRef, useState, type SelectHTMLAttributes } from 'react';
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
    setActive(Math.max(0,ref.current!.selectedIndex));setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = ref.current!, popup = list.current!;
    const r = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(160, r.width), Math.max(0, innerWidth - 16));
    popup.style.width = `${width}px`;
    const naturalHeight = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
    const below = Math.max(0, innerHeight - r.bottom - 12);
    const above = Math.max(0, r.top - 12);
    const down = Math.min(280, naturalHeight) <= below || below >= above;
    const maxHeight = Math.min(280, down ? below : above);
    const height = Math.min(naturalHeight, maxHeight);
    const next = {left:Math.max(8, Math.min(r.left, innerWidth-width-8)), top:down?r.bottom+4:Math.max(8,r.top-height-4), width, maxHeight};
    setRect(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    // A mode/layout change can move the anchor without a window resize or scroll.
    let frame: number;
    const track = () => {
      const current = trigger.getBoundingClientRect();
      if (current.x !== r.x || current.y !== r.y || current.width !== r.width || current.height !== r.height) setOpen(false);
      else frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [open, props.children]);
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
    const scroll=(e:Event)=>{if(!list.current?.contains(e.target as Node))setOpen(false);};
    window.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);};
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
    }}/>{open&&createPortal(<div ref={list} id={id} role="listbox" aria-label={props['aria-label']??ref.current?.labels?.[0]?.textContent??'选项'} className="studio-select-list" style={rect} onPointerDown={e=>{e.preventDefault();e.stopPropagation();}}>{options.map((o,i)=><div key={i} id={`${id}-${i}`} data-index={i} role="option" aria-selected={o.selected} aria-disabled={o.disabled} data-active={active===i} onPointerMove={()=>{if(!o.disabled)setActive(i);}} onClick={e=>{e.stopPropagation();choose(i);}}>{o.text}</div>)}</div>,ref.current?.closest('[role="dialog"]')??document.body)}</>;
}
