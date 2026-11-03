import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { createContext, useContext, Children, isValidElement, cloneElement, Fragment, useEffect, useRef, type ReactNode, type ReactElement } from 'react';
import { IconButton } from '../../shared/Controls';
import styles from './semantic-editor.module.css';

export const DialogEditingLocked = createContext(false);
function lockActions(actions: ReactNode): ReactNode {
  return Children.map(actions, child => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<{ children?: ReactNode; disabled?: boolean; 'data-dialog-close'?: boolean }>;
    if (element.type === Fragment) return cloneElement(element, {}, lockActions(element.props.children));
    return element.props['data-dialog-close'] ? element : cloneElement(element, { disabled: true });
  });
}

export function SettingsDialog({ title, subtitle, close, children, actions, returnFocus }: { title: string; returnFocus?: () => HTMLElement | null; subtitle?: string; actions?: ReactNode; close: () => void; children: ReactNode }) {
  const {t}=useTranslation();
  const locked = useContext(DialogEditingLocked);
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const initial = ref.current?.querySelector<HTMLElement>('[data-initial-focus]');
    if (initial) initial.focus();
    else if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { if (returnFocus) { returnFocus()?.focus(); return; } const target = previous.current; if (target?.isConnected && !target.matches(':disabled')) target.focus(); else document.querySelector<HTMLElement>('[data-top-menu="settings"] summary')?.focus(); };
  }, []);
  return createPortal(<div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('summary, button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []).filter(item => {
        if (item.matches(':disabled') || !item.getClientRects().length) return false;
        if (!(item instanceof HTMLInputElement) || item.type !== 'radio' || !item.name) return true;
        const group = Array.from(ref.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []).filter(radio => radio.name === item.name && !radio.disabled);
        return item === (group.find(radio => radio.checked) ?? group[0]);
      });
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === ref.current)) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }}>
      <div className={styles.dialogHeader}><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}<IconButton icon="close" data-role="secondary" label={t('settings.closeTitle',{title})} onClick={close}/></div>
      <div className={styles.dialogBody}><fieldset disabled={locked} style={{display: 'contents'}}>{children}</fieldset></div>
      {actions && <div className={styles.dialogActions}>{locked ? lockActions(actions) : actions}</div>}
    </section>
  </div>, document.body);
}
