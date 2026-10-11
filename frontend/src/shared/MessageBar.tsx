import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Controls';
import './message-bar.css';

export type Notice = { text: string; role: 'alert' | 'status'; timeout?: number; origin: HTMLElement | null; dismissible?: boolean; taskId?: string };
// Each publication is a new event, even when its text is unchanged.
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const publish = useCallback((text: string | null, role: Notice['role'] = 'alert', timeout?: number, taskId?: string) => {
    const event = text ? { text, role, timeout, taskId, origin: document.activeElement instanceof HTMLElement ? document.activeElement : null } : null;
    setNotice(event);
    return event;
  }, []);
  return [notice, publish] as const;
}

export function MessageBar({ notice, actions }: { notice: Notice | null; actions?: ReactNode }) {
  const [dismissed, setDismissed] = useState<Notice | null>(null);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hide = useCallback(() => {
    if (root.current?.contains(document.activeElement)) {
      const origin = notice?.origin;
      if (origin?.isConnected && !origin.closest('[data-message-bar]') && origin.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]')) origin.focus();
      else root.current.closest('main, [data-workspace]')?.querySelector<HTMLElement>('nav button[aria-current="page"], button:not(:disabled), [tabindex="0"]')?.focus();
    }
    setFocused(false);
    setDismissed(notice);
  }, [notice]);
  useEffect(() => { setFocused(!!root.current?.contains(document.activeElement)); }, [notice]);
  useEffect(() => {
    if (!notice?.timeout || notice.dismissible === false || dismissed === notice || focused) return;
    const timer = window.setTimeout(hide, notice.timeout);
    return () => window.clearTimeout(timer);
  }, [notice, dismissed, hide, focused]);
  if (!notice || dismissed === notice) return null;
  return <div ref={root} data-message-bar className="message-bar" onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <span role={notice.role}>{notice.text}</span>
    {actions && <div className="message-bar-actions">{actions}</div>}
    {notice.dismissible !== false && <IconButton icon="close" label="关闭提示" onClick={hide}/>}
  </div>;
}
