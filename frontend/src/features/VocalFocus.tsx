import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './vocal.module.css';
export function VocalFocus({ active, cancel }: { active:boolean; cancel:()=>void }) {
  const [mask,setMask]=useState('');
  useLayoutEffect(()=>{
    if(!active){const timer=setTimeout(()=>setMask(''),180);return()=>clearTimeout(timer);}
    const group=document.querySelector<HTMLElement>('[data-vocal-focus]')!;
    const hint=document.querySelector<HTMLElement>('[data-vocal-hint]');
    const measure=()=>{
      const rects=[group,hint].filter((e):e is HTMLElement=>!!e).map(e=>e.getBoundingClientRect());
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><defs><filter id="soft"><feGaussianBlur stdDeviation="4"/></filter></defs><rect width="100%" height="100%" fill="white"/>${rects.map(r=>`<rect x="${r.left-8}" y="${r.top-8}" width="${r.width+16}" height="${r.height+16}" rx="8" fill="black" filter="url(#soft)"/>`).join('')}</svg>`;
      setMask(`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    };
    const outside=(e:globalThis.PointerEvent)=>{
      if(group.contains(e.target as Node)||hint?.contains(e.target as Node))return;
      e.preventDefault();e.stopImmediatePropagation();
      const consume=(click:MouseEvent)=>{click.preventDefault();click.stopImmediatePropagation();};
      window.addEventListener('click',consume,{capture:true,once:true});
      setTimeout(()=>window.removeEventListener('click',consume,true),1000);
      cancel();
    };
    const key=(e:KeyboardEvent)=>{e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape')cancel();};
    group.focus(); measure();
    const observer=new ResizeObserver(measure);observer.observe(group);if(hint)observer.observe(hint);
    window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    window.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);window.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key,true);};
  },[active,cancel]);
  if(!mask)return null;
  return createPortal(<div className={styles.veil} style={{maskImage:mask,maskMode:'luminance',opacity:active?1:0}}/>,document.body);
}
