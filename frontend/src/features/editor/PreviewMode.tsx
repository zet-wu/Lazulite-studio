import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Select } from '../../shared/Select';
import '@applemusic-like-lyrics/core/style.css';
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LyricDocument } from '../../domain/lyric-document';
import { toAmllLines } from '../../domain/preview-adapter';
import type { TransportHandle } from '../MediaTransport';
import { StudioLyricPlayer } from './StudioLyricPlayer';
import styles from './semantic-editor.module.css';

export function PreviewMode({ document, transport, onSelectLine }: { document: LyricDocument; transport?: RefObject<TransportHandle | null>; onSelectLine?: (id: string) => void }) {
  useTranslation();
  const player = useRef<LyricPlayerRef>(null);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showRomanization, setShowRomanization] = useState(true);
  const [romanizationTrackId, setRomanizationTrackId] = useState<string | null>(null);
  const [fadeWidth, setFadeWidth] = useState(0.5);
  const [hidePassed, setHidePassed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const lines = useMemo(() => toAmllLines(document, showTranslation, showRomanization, romanizationTrackId), [document, showTranslation, showRomanization, romanizationTrackId]);
  const lyricLines = useMemo(() => lines.map((line) => line.lyric), [lines]);
  const duration = Math.max(0, ...lines.map((line) => line.lyric.endTime));
  useEffect(() => {
    if (!transport) return;
    let frame = 0;
    let lastPlaying = false;
    const update = () => {
      const current = transport.current;
      if (current) {
        (player.current?.lyricPlayer as StudioLyricPlayer | undefined)?.syncMedia(current.getPositionMs(), current.getPlaybackRate(), current.isPlaying());
        const next = current.isPlaying();
        if (next !== lastPlaying) { lastPlaying = next; setPlaying(next); }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [transport]);
  return <section className={styles.previewMode} aria-label={t('preview.title')}>
    <div className={styles.previewSettings}>
      <strong>{t('preview.title')}</strong>
      <label><input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)} /> {t('capability.translation')}</label>
      <label><input type="checkbox" checked={showRomanization} onChange={(event) => setShowRomanization(event.target.checked)} /> {t('capability.romanization')}</label>
      {document.romanizationTracks.length > 1 && <label>{t('preview.track')}<Select value={romanizationTrackId ?? ''} onChange={(event) => setRomanizationTrackId(event.target.value || null)}><option value="">{t('preview.first')}</option>{document.romanizationTracks.map((track, index) => <option key={track.id} value={track.id}>{index + 1} · {track.language ?? t('editor.unspecifiedLanguage')}</option>)}</Select></label>}
      <label><input type="checkbox" checked={hidePassed} onChange={(event) => setHidePassed(event.target.checked)} /> {t('preview.hidePlayed')}</label>
      <label>{t('preview.gradient')}<input type="range" min="0.05" max="1.5" step="0.05" value={fadeWidth} onChange={(event) => setFadeWidth(Number(event.target.value))} /></label>
      {!transport && <label>{t('preview.position')}<input type="range" min="0" max={duration} disabled={duration <= 0} value={Math.min(localTime,duration)} onChange={(event) => setLocalTime(Number(event.target.value))} /></label>}
    </div>
    <div className={styles.previewBody}>
    {document.lines.some(line => !line.backgroundOf && document.lines.filter(bg => bg.backgroundOf === line.id).length > 1) && <p className={styles.toolHint}>{t('preview.backgroundLimit')}</p>}
    {document.lines.some(line => line.agentRefs.length > 1 || line.words.some(word => word.agentRefs?.length)) && <p className={styles.toolHint}>{t('preview.singerLimit')}</p>}
    {lines.length ? <div className={styles.previewPlayer}>
      <LyricPlayer lyricPlayer={StudioLyricPlayer} ref={player} lyricLines={lyricLines} currentTime={transport ? undefined : localTime}
        isSeeking={!transport} playing={transport ? playing : false} hidePassedLines={hidePassed} wordFadeWidth={fadeWidth}
        onLyricLineClick={(event) => {
          const matched = lines[event.lineIndex];
          if (!matched) return;
          const startTime = matched.lyric.startTime;
          onSelectLine?.(matched.id);
          if (transport) transport.current?.seekMs(startTime);
          else setLocalTime(startTime);
        }} />
    </div> : <p className={styles.toolHint}>{t(document.lines.length === 0 ? 'preview.empty' : 'preview.noTimes')}</p>}
    </div>
  </section>;
}

const t=i18n.t.bind(i18n);
