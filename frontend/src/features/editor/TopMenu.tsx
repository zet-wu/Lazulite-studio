import { useEffect, useRef, type ReactNode } from 'react';

export type MenuState = { activeMenuId: string | null; onMenuChange: (id: string | null) => void };
export function TopMenu({ id, title, className, activeMenuId, onMenuChange, children }: MenuState & { id: string; title: string; className: string; children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opened = activeMenuId === id;
  const clear = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => {
    if (!opened) return;
    const outside = (event: PointerEvent) => { if (!root.current!.contains(event.target as Node)) onMenuChange(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      onMenuChange(null); root.current!.querySelector('summary')!.focus();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { clear(); window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [opened, onMenuChange]);
  useEffect(() => () => clear(), []);
  return <details ref={root} open={opened} className={className} data-top-menu={id}
    onPointerEnter={clear}
    onPointerLeave={() => {
      if (!opened) return;
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!root.current!.contains(root.current!.ownerDocument.activeElement)) onMenuChange(null);
      }, 200);
    }}
    onBlur={event => { if (opened && !event.currentTarget.contains(event.relatedTarget as Node | null)) { clear(); onMenuChange(null); } }}>
    <summary aria-expanded={opened} onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}
      onClick={event => { event.preventDefault(); onMenuChange(opened ? null : id); }}>{title}</summary>
    <div onClick={event => { if ((event.target as Element).closest('button')) { clear(); onMenuChange(null); } }}>{children}</div>
  </details>;
}
