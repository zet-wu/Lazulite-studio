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
  return <section className={styles.previewMode} aria-label="AMLL 预览">
    <div className={styles.previewSettings}>
      <strong>AMLL 预览</strong>
      <label><input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)} /> 翻译</label>
      <label><input type="checkbox" checked={showRomanization} onChange={(event) => setShowRomanization(event.target.checked)} /> 音译</label>
      {document.romanizationTracks.length > 1 && <label>预览音译轨道 <Select value={romanizationTrackId ?? ''} onChange={(event) => setRomanizationTrackId(event.target.value || null)}><option value="">每行首条</option>{document.romanizationTracks.map((track, index) => <option key={track.id} value={track.id}>{index + 1} · {track.language ?? '未指定语言'}</option>)}</Select></label>}
      <label><input type="checkbox" checked={hidePassed} onChange={(event) => setHidePassed(event.target.checked)} /> 隐藏已播行</label>
      <label>词渐变宽度 <input type="range" min="0.05" max="1.5" step="0.05" value={fadeWidth} onChange={(event) => setFadeWidth(Number(event.target.value))} /></label>
      {!transport && <label>预览位置 <input type="range" min="0" max={duration} value={localTime} onChange={(event) => setLocalTime(Number(event.target.value))} /></label>}
    </div>
    {document.lines.some(line => !line.backgroundOf && document.lines.filter(bg => bg.backgroundOf === line.id).length > 1) && <p className={styles.toolHint}>当前 AMLL 预览不能忠实呈现多条背景歌词；完整内容保留在编辑与打轴中。</p>}
    {document.lines.some(line => line.agentRefs.length > 1 || line.words.some(word => word.agentRefs?.length)) && <p className={styles.toolHint}>当前 AMLL 预览只呈现行级默认／对唱两侧，不能忠实呈现合唱和词级歌手；完整身份保留在编辑中。</p>}
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
    </div> : <p className={styles.toolHint}>为歌词设置时间后可播放动态预览。未定时间仍保留在草稿中。</p>}
  </section>;
}
