import '@applemusic-like-lyrics/core/style.css';
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LyricDocument } from '../../domain/lyric-document';
import { toAmllLines } from '../../domain/preview-adapter';
import type { TransportHandle } from '../MediaTransport';
import styles from './semantic-editor.module.css';

export function PreviewMode({ document, transport, onSelectLine }: { document: LyricDocument; transport?: RefObject<TransportHandle | null>; onSelectLine?: (id: string) => void }) {
  const player = useRef<LyricPlayerRef>(null);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showRomanization, setShowRomanization] = useState(true);
  const [fadeWidth, setFadeWidth] = useState(0.5);
  const [hidePassed, setHidePassed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const lines = useMemo(() => toAmllLines(document, showTranslation, showRomanization), [document, showTranslation, showRomanization]);
  const lyricLines = useMemo(() => lines.map((line) => line.lyric), [lines]);
  const duration = Math.max(0, ...lines.map((line) => line.lyric.endTime));
  useEffect(() => {
    if (!transport) return;
    let frame = 0;
    let lastPlaying = false;
    const update = () => {
      const current = transport.current;
      if (current) {
        player.current?.lyricPlayer?.setCurrentTime(Math.round(current.getPositionUs() / 1000));
        const next = current.isPlaying();
        if (next !== lastPlaying) { lastPlaying = next; setPlaying(next); }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [transport]);
  return <section className={styles.previewMode} aria-label="动态歌词预览">
    <div className={styles.previewSettings}>
      <strong>动态预览</strong>
      <label><input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)} /> 翻译</label>
      <label><input type="checkbox" checked={showRomanization} onChange={(event) => setShowRomanization(event.target.checked)} /> 音译</label>
      <label><input type="checkbox" checked={hidePassed} onChange={(event) => setHidePassed(event.target.checked)} /> 隐藏已播行</label>
      <label>词渐变宽度 <input type="range" min="0.05" max="1.5" step="0.05" value={fadeWidth} onChange={(event) => setFadeWidth(Number(event.target.value))} /></label>
      {!transport && <label>试听位置 <input type="range" min="0" max={duration} value={localTime} onChange={(event) => setLocalTime(Number(event.target.value))} /></label>}
    </div>
    {lines.length ? <div className={styles.previewPlayer}>
      <LyricPlayer ref={player} lyricLines={lyricLines} currentTime={transport ? undefined : localTime}
        playing={transport ? playing : false} hidePassedLines={hidePassed} wordFadeWidth={fadeWidth}
        onLyricLineClick={(event) => {
          const startTime = event.line.getLine().startTime;
          const matched = lines.find((line) => line.lyric.startTime === startTime);
          if (matched) onSelectLine?.(matched.id);
          if (transport) transport.current?.seekUs(startTime * 1000);
          else setLocalTime(startTime);
        }} />
    </div> : <p className={styles.toolHint}>为歌词设置时间后可播放动态预览。未定时间仍保留在草稿中。</p>}
  </section>;
}
