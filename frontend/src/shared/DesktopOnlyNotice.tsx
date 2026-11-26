import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopDownloadUrl } from '../adapters/runtime';
import styles from './desktop-only-notice.module.css';

export function DesktopDownloadLink() {
  const { t } = useTranslation();
  return <a href={desktopDownloadUrl} target="_blank" rel="noopener noreferrer">{t('demo.download')}</a>;
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
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label={t('demo.desktopOnly')} onCancel={close} onClose={close}>
    <DesktopOnlyNotice />
    <button type="button" data-role="secondary" autoFocus onClick={close}>{t('common.close')}</button>
  </dialog>;
}
