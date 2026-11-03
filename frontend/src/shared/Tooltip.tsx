import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

let hideCurrent: (() => void) | null = null;

/** A small descriptive hint. The persistent description is also available while hidden. */
export function Tooltip({ children, content, id, as: Tag = 'span', className, ...attributes }: {
  children: ReactNode; content: string; id?: string; as?: 'span' | 'div'; className?: string;
}) {
  const generated = useId(), description = id ?? generated;
  const anchor = useRef<HTMLElement>(null), popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false), focused = useRef(false), suppressed = useRef(false);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const hide = useRef(() => setOpen(false));
  const show = () => { hideCurrent?.(); hideCurrent = hide.current; setOpen(true); };
  const cancelTimer = () => { clearTimeout(timer.current); };
  const dismiss = () => { cancelTimer(); suppressed.current = true; setOpen(false); };
  const leave = () => {
    cancelTimer();
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) { setOpen(false); suppressed.current = false; }
    }, 120);
  };
  useEffect(() => () => { cancelTimer(); if (hideCurrent === hide.current) hideCurrent = null; }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      const control = event.target as HTMLElement;
      if (control.matches('[aria-expanded="true"]')) return;
      dismiss();
      event.preventDefault(); event.stopPropagation();
    };
    const pointer = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', pointer, true);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', pointer, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = anchor.current!, box = popup.current!;
      const rect = trigger.getBoundingClientRect(), size = box.getBoundingClientRect();
      const below = rect.bottom + 4;
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - size.width - 8)), top: Math.max(8, Math.min(below + size.height <= innerHeight - 8 ? below : rect.top - size.height - 4, innerHeight - size.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(popup.current!); observer.observe(anchor.current!);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, content]);
  return <Tag {...attributes} ref={anchor as React.Ref<HTMLDivElement> & React.Ref<HTMLSpanElement>} className={className}
    onMouseEnter={() => { hovered.current = true; cancelTimer(); if (!suppressed.current) timer.current = setTimeout(show, 600); }}
    onMouseLeave={() => { hovered.current = false; leave(); }}
    onFocusCapture={() => { focused.current = true; cancelTimer(); if (!suppressed.current) show(); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { focused.current = false; leave(); } }}
    onPointerDownCapture={dismiss}
    onKeyDownCapture={event => { if (event.key !== 'Escape' && event.key !== 'Tab') dismiss(); }}
    >
    {children}<span id={description} className="studio-tooltip-description">{content}</span>
    {open && createPortal(<div ref={popup} role="tooltip" className="studio-tooltip" style={position}
      onMouseEnter={() => { hovered.current = true; cancelTimer(); }} onMouseLeave={() => { hovered.current = false; leave(); }}>{content}</div>, document.body)}
  </Tag>;
}
