import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../../shared/Controls';
import styles from './semantic-editor.module.css';

export function SettingsDialog({ title, subtitle, close, children, actions }: { title: string; subtitle?: string; actions?: ReactNode; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const initial = ref.current?.querySelector<HTMLElement>('[data-initial-focus]');
    if (initial) initial.focus();
    else if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => previous.current?.focus();
  }, []);
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('summary, button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []).filter(item => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === ref.current)) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }}>
      <div className={styles.dialogHeader}><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}<IconButton icon="close" data-role="secondary" label={`关闭${title}`} onClick={close}/></div>
      <div className={styles.dialogBody}>{children}</div>
      {actions && <div className={styles.dialogActions}>{actions}</div>}
    </section>
  </div>;
}
