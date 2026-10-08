import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from './Controls';
import './message-bar.css';

export type Notice = { text: string; role: 'alert' | 'status'; timeout?: number; origin: HTMLElement | null };
// Each publication is a new event, even when its text is unchanged.
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const publish = useCallback((text: string | null, role: Notice['role'] = 'alert', timeout?: number) => {
    setNotice(text ? { text, role, timeout, origin: document.activeElement instanceof HTMLElement ? document.activeElement : null } : null);
  }, []);
  return [notice, publish] as const;
}

export function MessageBar({ notice }: { notice: Notice | null }) {
  const [dismissed, setDismissed] = useState<Notice | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hide = useCallback(() => {
    if (root.current?.contains(document.activeElement)) {
      const origin = notice?.origin;
      if (origin?.isConnected && !origin.closest('[data-message-bar]') && origin.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]')) origin.focus();
      else root.current.closest('main, [data-workspace]')?.querySelector<HTMLElement>('nav button[aria-current="page"], button:not(:disabled), [tabindex="0"]')?.focus();
    }
    setDismissed(notice);
  }, [notice]);
  useEffect(() => {
    if (!notice?.timeout || dismissed === notice) return;
    const timer = window.setTimeout(hide, notice.timeout);
    return () => window.clearTimeout(timer);
  }, [notice, dismissed, hide]);
  if (!notice || dismissed === notice) return null;
  return <div ref={root} data-message-bar className="message-bar">
    <span role={notice.role}>{notice.text}</span>
    <IconButton icon="close" label="关闭提示" onClick={hide}/>
  </div>;
}
