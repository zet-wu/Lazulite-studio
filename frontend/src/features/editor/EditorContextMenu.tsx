import { useEffect, useRef } from 'react';
import styles from './semantic-editor.module.css';

export type ContextAction = { label: string; run: () => void; disabled?: boolean; reason?: string };

export function EditorContextMenu({ x, y, title, actions, close }: { x: number; y: number; title: string; actions: ContextAction[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [close]);
  return <div ref={ref} role="menu" aria-label={title} className={styles.contextMenu}
    style={{ left: Math.max(8, Math.min(x, window.innerWidth - 230)), top: Math.min(y, window.innerHeight - Math.min(420, actions.length * 34 + 10)) }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
    {actions.map((item, index) => <button data-role="inline" key={`${index}:${item.label}`} role="menuitem" disabled={item.disabled}
      onClick={() => { close(); item.run(); }}>{item.label}{item.reason && <small> · {item.reason}</small>}</button>)}
  </div>;
}
