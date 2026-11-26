import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudioReview } from './AudioReviewContext';
import { DesktopOnlyDialog } from '../shared/DesktopOnlyNotice';

/** Preserve the audio toolbar portals without mounting any job or model hooks. */
export function BrowserAudioEntry({ kind, visible }: { kind: 'vocal' | 'alignment'; visible: boolean }) {
  const { t } = useTranslation();
  const ui = useAudioReview();
  const [open, setOpen] = useState(false);
  const request = useRef(ui.alignmentRequest);
  useEffect(() => {
    if (kind === 'alignment' && request.current !== ui.alignmentRequest) setOpen(true);
    request.current = ui.alignmentRequest;
  }, [ui.alignmentRequest, kind]);
  const host = kind === 'vocal' ? ui.analysisHost : ui.alignmentHost;
  return <>
    {visible && host && createPortal(<button data-role="secondary" onClick={() => setOpen(true)}>{t(kind === 'vocal' ? 'vocal.separate' : 'settings.alignment')}</button>, host)}
    {open && <DesktopOnlyDialog close={() => setOpen(false)} />}
  </>;
}
