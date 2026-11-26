import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopDownloadUrl } from '../adapters/runtime';
import styles from './desktop-only-notice.module.css';

export function DesktopDownloadLink() {
  const { t } = useTranslation();
  return <a data-role="secondary" href={desktopDownloadUrl} target="_blank" rel="noopener noreferrer">{t('demo.download')}</a>;
}

export function DesktopOnlyNotice() {
  const { t } = useTranslation();
  return <section className={styles.notice}>
    <strong>{t('demo.desktopOnly')}</strong>
    <p>{t('demo.desktopHelp')}</p>
    <DesktopDownloadLink />
  </section>;
}

export function DesktopOnlyDialog({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label={t('demo.desktopOnly')} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
    const target = event.shiftKey ? items.at(-1) : items[0];
    if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) { event.preventDefault(); target?.focus(); }
  }}>
    <DesktopOnlyNotice />
    <button type="button" data-role="secondary" autoFocus onClick={close}>{t('common.close')}</button>
  </dialog>;
}
