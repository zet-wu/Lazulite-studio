import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './context-menu.css';

export type ContextAction = { id?: string; label: string; run: () => void; disabled?: boolean; reason?: string; danger?: boolean };
export function ContextMenu({ x, y, title, actions, close, target, returnFocus }: { x: number; y: number; title: string; actions: ContextAction[]; close: () => void; target: HTMLElement | null; returnFocus?: () => void }) {
  const ref = useRef<HTMLDivElement>(null), latestClose = useRef(close);
  latestClose.current = close;
  const restoreOnUnmount = useRef(true);
  const [position, setPosition] = useState({left:x, top:y});
  const restoreFocus = () => { if (returnFocus) returnFocus(); else if (target?.isConnected && !target.matches(':disabled')) target.focus({preventScroll:true}); };
  const dismiss = (restore: boolean) => {
    restoreOnUnmount.current = false;
    if (restore) restoreFocus();
    latestClose.current();
  };
  useLayoutEffect(() => {
    const place = () => {
      const size = ref.current!.getBoundingClientRect();
      setPosition({left:Math.max(8,Math.min(x,innerWidth-size.width-8)),top:Math.max(8,Math.min(y,innerHeight-size.height-8))});
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(ref.current!);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [x,y]);
  useEffect(() => {
    const menu=ref.current!;
    (menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? menu).focus();
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) { restoreOnUnmount.current = false; latestClose.current(); } };
    const blur = () => { restoreOnUnmount.current = false; latestClose.current(); };
    window.addEventListener('pointerdown',outside); window.addEventListener('focusin',outside); window.addEventListener('blur',blur);
    return () => { window.removeEventListener('pointerdown',outside); window.removeEventListener('focusin',outside); window.removeEventListener('blur',blur);
      if (restoreOnUnmount.current && menu.contains(document.activeElement)) restoreFocus();
    };
  }, []);
  return createPortal(<div ref={ref} role="menu" aria-label={title} tabIndex={-1} className="studio-context-menu" style={position}
    onKeyDown={event => {
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss(true);}
      if(event.key==='Tab')dismiss(true);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        const items=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
        const index=items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
      }
    }}>
    {actions.map((item,index)=><button type="button" key={item.id ?? index} role="menuitem" data-role={item.danger?'danger':'inline'} disabled={item.disabled} title={item.reason}
      onClick={()=>{dismiss(true);item.run();}}>{item.label}</button>)}
  </div>,document.body);
}
