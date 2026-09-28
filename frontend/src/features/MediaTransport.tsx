import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  studioApi,
  type Asset,
} from "../adapters/http/client";
import styles from "./media.module.css";
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument } from '../domain/lyric-document';
import { TimelineTracks } from './TimelineTracks';
import { useCanvasMetrics } from './useCanvasMetrics';
import { SpectrogramCanvas } from './SpectrogramCanvas';
import { estimateBpm } from '../domain/bpm';
import { panViewport, waveformRequestWindow, zoomViewport } from '../domain/timeline-viewport';
import { captureLoop, emptyLoop, loopRange as activeLoopRange, setLoopA, setLoopB, type LoopState } from '../domain/timeline-loop';

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "--:--.---";
  const ms = Math.max(0, Math.floor(s * 1000));
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const offset = (asset: Asset | null) => (asset?.proxy_offset_us ?? 0) / 1e6;
type Props = {
  projectId: string;
  selectedLine?: { begin_us: number | null; end_us: number | null };
  asset: Asset | null;
  loopRange?: { begin_us: number; end_us: number };
  onPosition?: (positionUs: number) => void;
  document?: LyricDocument;
  selectedLineId?: string | null;
  selectedRomanization?: { trackId: string; contentId: string } | null;
  onTimelineCommand?: (command: LyricCommand) => void;
  onSelectLine?: (lineId: string) => void;
};

export type TransportHandle = {
  getPositionUs: () => number;
  isPlaying: () => boolean;
  seekUs: (timeUs: number) => void;
  play: () => void;
  pause: () => void;
  audition: (beginUs: number, endUs: number) => void;
};

export const MediaTransport = forwardRef<TransportHandle, Props>(function MediaTransport({
  projectId,
  selectedLine,
  asset,
  loopRange,
  onPosition,
  document,
  selectedLineId,
  selectedRomanization,
  onTimelineCommand,
  onSelectLine,
}: Props, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const raf = useRef<number | undefined>(undefined);
  const moveAnimation = useRef<number | null>(null);
  const panDrag = useRef<{ x: number; startUs: number; left: number; width: number; pointerId: number; started: boolean } | null>(null);
  const loopDrag = useRef<{ side: 'a' | 'b'; original: LoopState; left: number; width: number; pointerId: number } | null>(null);
  const lastTrackPaint = useRef(0);
  const positionRef = useRef(0);
  const auditionEnd = useRef<number | null>(null);
  const [duration, setDuration] = useState(
    asset?.duration_us ? asset.duration_us / 1e6 : 0,
  );
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [start, setStart] = useState(0);
  const [span, setSpan] = useState(0);

  const [loop, setLoop] = useState<LoopState>(emptyLoop);
  const [error, setError] = useState("");
  const [bpm, setBpm] = useState(120);
  const [snap, setSnap] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState({ line: true, word: true, ruby: true, gap: true, spectrum: false });
  const { width, ratio } = useCanvasMetrics(canvas, expanded);
  const [follow, setFollow] = useState(false);
  const viewportRef = useRef({ start, span, duration, follow });
  viewportRef.current = { start, span, duration, follow };
  const [bpmStatus, setBpmStatus] = useState('');
  useEffect(() => () => { if (moveAnimation.current !== null) cancelAnimationFrame(moveAnimation.current); }, []);
  const tapTimes = useRef<number[]>([]);
  const startUs = Math.round(start * 1e6);
  const end = Math.min(duration, start + span);
  const endUs = Math.round(end * 1e6);
  const durationUs = Math.round(duration * 1e6);
  const requestWindow = waveformRequestWindow({ startUs, spanUs: Math.round(span * 1e6) }, durationUs);
  const level = Math.max(
    0,
    Math.min(
      15,
      Math.ceil(Math.log2((Math.max(1, span) * 100) / Math.max(1, width))),
    ),
  );
  const waveform = useQuery({
    queryKey: ["waveform", projectId, requestWindow.startUs, requestWindow.endUs, level],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      studioApi.getWaveform(projectId, requestWindow.startUs, requestWindow.endUs, level, signal),
    enabled: Boolean(asset) && expanded && span > 0 && end > start,
    staleTime: 60000,
  });
  const validLine =
    selectedLine?.begin_us != null &&
    selectedLine.end_us != null &&
    selectedLine.begin_us >= 0 &&
    selectedLine.end_us > selectedLine.begin_us &&
    selectedLine.end_us <= duration * 1e6;
  const validUnit = Boolean(
    loopRange &&
      Number.isSafeInteger(loopRange.begin_us) &&
      Number.isSafeInteger(loopRange.end_us) &&
      loopRange.begin_us >= 0 &&
      loopRange.begin_us < loopRange.end_us &&
      loopRange.end_us <= duration * 1e6,
  );
  const activeLoop = useCallback(() => {
    const range = activeLoopRange(loop, durationUs);
    return range ? [range[0] / 1e6, range[1] / 1e6] as const : null;
  }, [durationUs, loop]);
  const readPosition = useCallback(
    () =>
      audio.current
        ? audio.current.currentTime + offset(asset)
        : positionRef.current,
    [asset],
  );
  const updateDom = useCallback(
    (raw: number) => {
      const { start: viewStart, span: viewSpan, duration: mediaDuration } = viewportRef.current;
      const current = Math.max(0, Math.min(mediaDuration || raw, raw));
      positionRef.current = current;
      if (clock.current)
        clock.current.textContent = `${fmt(current)} / ${fmt(mediaDuration)}`;
      slider.current?.setAttribute("aria-valuenow", String(current));
      if (head.current)
        head.current.style.left = `${viewSpan ? ((current - viewStart) / viewSpan) * 100 : 0}%`;
      if (head.current)
        head.current.style.display =
          current >= viewStart && current <= viewStart + viewSpan ? "block" : "none";
      onPosition?.(Math.round(current * 1_000_000));
    },
    [onPosition],
  );
  const seekTo = useCallback(
    (raw: number) => {
      if (!audio.current || !asset || !duration) return;
      auditionEnd.current = null;
      const current = Math.max(0, Math.min(duration, raw));
      audio.current.currentTime = Math.max(0, current - offset(asset));
      updateDom(current);
      setPosition(current);
    },
    [asset, duration, updateDom],
  );
  const play = useCallback(() => {
    if (!audio.current || !asset) return;
    setError("");
    if (audio.current.paused)
      void audio.current.play().catch(() => setError("媒体无法播放，请重试"));
    else audio.current.pause();
  }, [asset]);
  useImperativeHandle(ref, () => ({
    getPositionUs: () => Math.round(positionRef.current * 1_000_000),
    isPlaying: () => Boolean(audio.current && !audio.current.paused),
    seekUs: (timeUs) => { auditionEnd.current = null; seekTo(timeUs / 1_000_000); },
    play: () => { if (audio.current?.paused) play(); },
    pause: () => audio.current?.pause(),
    audition: (beginUs, endUs) => {
      if (!asset || endUs <= beginUs) return;
      seekTo(beginUs / 1_000_000);
      auditionEnd.current = endUs / 1_000_000;
      if (audio.current?.paused) play();
    },
  }), [asset, play, seekTo]);

  useEffect(() => {
    const d = asset?.duration_us ? asset.duration_us / 1e6 : 0;
    setDuration(d);
    setSpan(d);
    setStart(0);
    setPosition(0);
    positionRef.current = 0;
    setLoop(emptyLoop());
    setPlaying(false);
  }, [asset?.id, asset?.duration_us]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const sync = () => updateDom(readPosition());
    const metadata = () => {
      setError('');
      if (!asset?.duration_us && Number.isFinite(el.duration))
        setDuration(el.duration);
      if (!asset?.duration_us && Number.isFinite(el.duration))
        setSpan(el.duration);
    };
    const ended = () => {
      if (auditionEnd.current !== null) { auditionEnd.current = null; return; }
      const range = activeLoop();
      if (!range) return;
      el.currentTime = Math.max(0, range[0] - offset(asset));
      updateDom(range[0]);
      void el.play().catch(() => setError("媒体无法播放，请重试"));
    };
    const onError = () => setError("媒体无法播放，请重试");
    const onPlay = () => {
      setPlaying(true);
      sync();
    };
    const syncFinalPosition = () => { const current = readPosition(); updateDom(current); setPosition(current); };
    const onPause = () => {
      setPlaying(false);
      syncFinalPosition();
    };
    el.addEventListener("loadedmetadata", metadata);
    el.addEventListener("timeupdate", sync);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("seeked", syncFinalPosition);
    el.addEventListener("error", onError);
    el.addEventListener("ended", ended);
    sync();
    return () => {
      el.removeEventListener("loadedmetadata", metadata);
      el.removeEventListener("timeupdate", sync);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("seeked", syncFinalPosition);
      el.removeEventListener("error", onError);
      el.removeEventListener("ended", ended);
    };
  }, [activeLoop, asset, readPosition, updateDom]);
  useEffect(() => {
    const el = audio.current;
    if (!el || !playing) return;
    const frame = () => {
      const current = readPosition();
      updateDom(current);
      if (performance.now() - lastTrackPaint.current > 80) {
        setPosition(current);
        lastTrackPaint.current = performance.now();
      }
      const view = viewportRef.current;
      if (view.follow && view.span < view.duration) {
        const target = Math.max(0, Math.min(view.duration - view.span, current - view.span * 0.35));
        setStart((value) => Math.abs(target - value) < 0.001 ? target : value + (target - value) * 0.12);
      }
      if (auditionEnd.current !== null && current >= auditionEnd.current) {
        auditionEnd.current = null;
        el.pause();
        return;
      }
      const range = auditionEnd.current === null ? activeLoop() : null;
      if (range && current >= range[1]) {
        el.currentTime = Math.max(0, range[0] - offset(asset));
        updateDom(range[0]);
      }
      if (!el.paused) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current ?? 0);
  }, [activeLoop, asset, playing, readPosition, updateDom]);

  useEffect(() => {
    if (loopDrag.current) return;
    const range = activeLoop();
    if (!range || !audio.current) return;
    const current = readPosition();
    if (current < range[0] || current >= range[1]) seekTo(range[0]);
  }, [activeLoop, readPosition, seekTo]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const draw = () => {
      const r = c.getBoundingClientRect();
      const scale = ratio;
      c.width = Math.max(1, Math.round(r.width * scale));
      c.height = Math.max(1, Math.round(r.height * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const d = waveform.data;
      if (!d || endUs <= startUs) return;
      ctx.strokeStyle = "#91aee4";
      const view = endUs - startUs;
      d.maximum.forEach((max, i) => {
        const min = d.minimum[i] ?? max;
        const x =
          ((d.start_us + i * d.bucket_us - startUs) / view) * r.width +
          Math.max(1, (d.bucket_us / view) * r.width) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, ((1 - max) * r.height) / 2);
        ctx.lineTo(Math.round(x) + 0.5, ((1 - min) * r.height) / 2);
        ctx.stroke();
      });
    };
    draw();
  }, [endUs, startUs, waveform.data, width, ratio]);
  const zoomAt = (factor: number, fraction: number) => {
    if (moveAnimation.current !== null) { cancelAnimationFrame(moveAnimation.current); moveAnimation.current = null; }
    const next = zoomViewport({ startUs, spanUs: Math.round(span * 1e6) }, durationUs, factor, fraction);
    if (next.startUs === startUs && next.spanUs === Math.round(span * 1e6)) return false;
    setFollow(false);
    setStart(next.startUs / 1e6);
    setSpan(next.spanUs / 1e6);
    return true;
  };
  const move = (direction: number) => {
    if (moveAnimation.current !== null) cancelAnimationFrame(moveAnimation.current);
    setFollow(false);
    const from = startUs;
    const to = panViewport({ startUs, spanUs: Math.round(span * 1e6) }, durationUs, direction * Math.max(20_000, Math.round(span * 100_000))).startUs;
    const began = performance.now();
    const frame = (now: number) => {
      const fraction = Math.min(1, (now - began) / 180);
      const eased = 1 - (1 - fraction) ** 3;
      setStart((from + (to - from) * eased) / 1e6);
      moveAnimation.current = fraction < 1 ? requestAnimationFrame(frame) : null;
    };
    moveAnimation.current = requestAnimationFrame(frame);
  };
  const wheelView = (event: WheelEvent<HTMLDivElement>) => {
    if (!asset || event.ctrlKey || event.metaKey) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const delta = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    if (zoomAt(Math.exp(delta * 0.001), (event.clientX - rect.left) / rect.width)) event.preventDefault();
  };
  const beginPan = (event: PointerEvent<HTMLElement>) => {
    if (!asset || event.button !== 0 || (event.target as Element).closest('[data-loop-handle]')) return;
    if (moveAnimation.current !== null) { cancelAnimationFrame(moveAnimation.current); moveAnimation.current = null; }
    const rect = event.currentTarget.getBoundingClientRect();
    panDrag.current = { x: event.clientX, startUs, left: rect.left, width: rect.width, pointerId: event.pointerId, started: false };
  };
  const movePan = (event: PointerEvent<HTMLElement>) => {
    const current = panDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.started) {
      if (Math.abs(event.clientX - current.x) < 4) return;
      current.started = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setFollow(false);
    }
    event.preventDefault();
    const next = panViewport({ startUs: current.startUs, spanUs: Math.round(span * 1e6) }, durationUs, -(event.clientX - current.x) / current.width * span * 1e6);
    setStart(next.startUs / 1e6);
  };
  const endPan = (event: PointerEvent<HTMLElement>) => {
    const current = panDrag.current;
    panDrag.current = null;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.started) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } else { setFollow(false); seekTo(start + (event.clientX - current.left) / current.width * span); }
  };
  const beginLoopDrag = (event: PointerEvent<HTMLSpanElement>, side: 'a' | 'b') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = slider.current!.getBoundingClientRect();
    loopDrag.current = { side, original: loop, left: rect.left, width: rect.width, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveLoopDrag = (event: PointerEvent<HTMLSpanElement>) => {
    const current = loopDrag.current;
    if (!current || current.pointerId !== event.pointerId || loop.aUs === null || loop.bUs === null) return;
    event.preventDefault(); event.stopPropagation();
    const value = Math.round(startUs + (event.clientX - current.left) / current.width * span * 1e6);
    setLoop((state) => current.side === 'a'
      ? { ...state, aUs: Math.max(0, Math.min(state.bUs! - 1, value)) }
      : { ...state, bUs: Math.min(durationUs, Math.max(state.aUs! + 1, value)) });
  };
  const endLoopDrag = (event: PointerEvent<HTMLSpanElement>, cancel = false) => {
    const current = loopDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (cancel) setLoop(current.original);
    loopDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const interactive = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return Boolean(
      el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) ||
          el.closest("[role=button]")),
    );
  };
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && (panDrag.current || loopDrag.current)) {
      if (panDrag.current) setStart(panDrag.current.startUs / 1e6);
      if (loopDrag.current) setLoop(loopDrag.current.original);
      panDrag.current = null; loopDrag.current = null;
      e.preventDefault(); return;
    }
    if (
      !asset ||
      e.nativeEvent.isComposing ||
      e.repeat ||
      interactive(e.target)
    )
      return;
    if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      seekTo(
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? duration
            : positionRef.current + (e.key === "ArrowRight" ? 1 : -1),
      );
    }
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && (panDrag.current || loopDrag.current)) {
        if (panDrag.current) setStart(panDrag.current.startUs / 1e6);
        if (loopDrag.current) setLoop(loopDrag.current.original);
        panDrag.current = null; loopDrag.current = null;
        e.preventDefault(); return;
      }
      if (
        e.key === " " &&
        !e.defaultPrevented &&
        !e.isComposing &&
        !e.repeat &&
        asset &&
        !interactive(e.target)
      ) {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, play]);
  const disabled = !asset;
  const retryMedia = () => {
    audio.current?.load();
    play();
  };
  const bandA = loop.aUs === null ? null : loop.aUs / 1e6;
  const bandB = loop.bUs === null ? null : loop.bUs / 1e6;
  const playGlyph = playing ? <svg width="13" height="14" viewBox="0 0 13 14" aria-hidden="true"><rect x="2" y="1" width="3" height="12" fill="currentColor" /><rect x="8" y="1" width="3" height="12" fill="currentColor" /></svg> : '▶';
  const tapBpm = () => {
    const now = performance.now();
    tapTimes.current = [...tapTimes.current.filter((value) => now - value < 3000), now].slice(-8);
    const intervals = tapTimes.current.slice(1).map((value, index) => value - tapTimes.current[index]);
    if (intervals.length >= 2) {
      const sorted = intervals.slice().sort((left, right) => left - right);
      setBpm(Math.round(60_000 / sorted[Math.floor(sorted.length / 2)]));
    }
  };
  const autoBpm = async () => {
    try {
      setBpmStatus('分析中…');
      const window = await studioApi.getWaveform(projectId, 0, Math.min(Math.round(duration * 1e6), 20_000_000), 0);
      const result = estimateBpm(window.minimum, window.maximum, window.bucket_us);
      if (result === null) { setBpmStatus('未检测到稳定节拍'); return; }
      setBpm(result);
      setBpmStatus(`检测到 ${result} BPM`);
    } catch {
      setBpmStatus('BPM 分析失败');
    }
  };
  const beatUs = 60_000_000 / bpm;
  const firstBeat = Math.ceil(startUs / beatUs);
  const beatCount = bpm > 0 && endUs > startUs ? Math.max(0, Math.min(500, Math.floor((endUs - firstBeat * beatUs) / beatUs) + 1)) : 0;
  const maxTicks = Math.max(2, Math.floor(width / 82));
  const tickStep = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((value) => span / value <= maxTicks) ?? 600;
  const ticks = span > 0 ? Array.from({ length: Math.min(maxTicks + 1, Math.max(0, Math.floor(end / tickStep) - Math.ceil(start / tickStep) + 1)) }, (_, index) => (Math.ceil(start / tickStep) + index) * tickStep) : [];
  return (
    <footer className={`${styles.footer} ${expanded ? styles.expanded : styles.collapsed}`} onKeyDown={keyDown}>
      <audio
        ref={audio}
        preload="metadata"
        src={asset ? studioApi.audioUrl(projectId) : undefined}
      />
      <div className={styles.header}>
        <button className={styles.play} disabled={disabled} aria-label={playing ? '暂停' : '播放'} onClick={play}>{playGlyph}</button>
        <span ref={clock}>{fmt(position)} / {fmt(duration)}</span>
        {expanded && <>
        <button
          disabled={disabled}
          onClick={() => { setFollow(false); setStart(0); setSpan(duration); }}
        >
          全曲
        </button>
        <button
          disabled={disabled}
          aria-label="前移窗口"
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <button
          disabled={disabled}
          aria-label="后移窗口"
          onClick={() => move(1)}
        >
          ›
        </button>
        <button disabled={disabled} aria-label="放大波形" onClick={() => zoomAt(0.5, span ? (positionRef.current - start) / span : 0.5)}>＋</button>
        <button disabled={disabled} aria-label="缩小波形" onClick={() => zoomAt(2, span ? (positionRef.current - start) / span : 0.5)}>−</button>
        <span className={styles.viewportRange}>视窗 {fmt(start)} – {fmt(end)}</span>
        <div className={styles.visibility} aria-label="时间轴图层">
          {(['line', 'word', 'ruby', 'gap', 'spectrum'] as const).map((key) => <button key={key} className={visible[key] ? styles.active : ''} aria-pressed={visible[key]} onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}>
            {({ line: '行', word: '词', ruby: 'Ruby', gap: '空隙', spectrum: '声谱图' })[key]}
          </button>)}
        </div>
        </>}
        <button className={styles.timelineToggle} aria-label={expanded ? "收起时间轴" : "展开时间轴"} title={expanded ? "收起时间轴" : "展开时间轴"} aria-expanded={expanded} aria-controls="timeline-plots" onClick={() => setExpanded(value => !value)}>
          <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d={expanded ? "M1 1h10L6 7z" : "M1 7h10L6 1z"} fill="currentColor" /></svg>
        </button>
      </div>
      {expanded && <>
      <div id="timeline-plots" className={styles.timelinePlots}>
      <div className={styles.ruler} aria-label="时间标尺" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={() => { panDrag.current = null; }}>{ticks.map((time) => <span data-tick-us={Math.round(time * 1e6)} key={time} style={{ left: `${(time - start) / span * 100}%` }}>{fmt(time)}</span>)}</div>
      <div
        ref={slider}
        className={styles.waveWrap}
        onWheel={wheelView}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={() => { panDrag.current = null; }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="波形进度"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={position}
      >
        <canvas
          ref={canvas}
          className={styles.wave}
        />
        <span ref={head} className={styles.head} />
        {snap && span <= 30 && Array.from({ length: beatCount }, (_, index) => <span key={index} className={styles.beatLine} style={{ left: `${((firstBeat + index) * beatUs - startUs) / (endUs - startUs) * 100}%` }} />)}
        {bandA != null && bandB != null && bandB > bandA && bandB >= start && bandA <= end && (
          <span
            className={styles.band}
            style={{
              left: `${Math.max(0, ((bandA - start) / span) * 100)}%`,
              width: `${Math.max(0, Math.min(100, ((bandB - start) / span) * 100) - Math.max(0, ((bandA - start) / span) * 100))}%`,
            }}
          />
        )}
        {bandA != null && bandB != null && (bandA >= start && bandA <= end || loopDrag.current?.side === 'a') && <span data-loop-handle="a" className={styles.loopHandle} role="slider" tabIndex={0} aria-label="循环 A 边界" aria-valuemin={0} aria-valuemax={bandB} aria-valuenow={bandA}
          style={{ left: `${Math.max(0, Math.min(100, ((bandA - start) / span) * 100))}%` }} onPointerDown={(event) => beginLoopDrag(event, 'a')} onPointerMove={moveLoopDrag} onPointerUp={endLoopDrag} onPointerCancel={(event) => endLoopDrag(event, true)} />}
        {bandA != null && bandB != null && (bandB >= start && bandB <= end || loopDrag.current?.side === 'b') && <span data-loop-handle="b" className={styles.loopHandle} role="slider" tabIndex={0} aria-label="循环 B 边界" aria-valuemin={bandA} aria-valuemax={duration} aria-valuenow={bandB}
          style={{ left: `${Math.max(0, Math.min(100, ((bandB - start) / span) * 100))}%` }} onPointerDown={(event) => beginLoopDrag(event, 'b')} onPointerMove={moveLoopDrag} onPointerUp={endLoopDrag} onPointerCancel={(event) => endLoopDrag(event, true)} />}
      </div>
      {document && onTimelineCommand && onSelectLine && <>
        <div className={styles.timelineTools}><strong>时间轴</strong><label>BPM <input type="number" min="30" max="300" value={bpm} onChange={(event) => { const value = Number(event.target.value); if (value >= 30 && value <= 300) setBpm(value); }} /></label>
          <button onClick={tapBpm}>Tap</button><button disabled={!asset} onClick={() => void autoBpm()}>自动 BPM</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 吸附</label><label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> 播放跟随</label><small>{bpmStatus || '拖动色块调整；Shift 点击行块选范围并成组移动；词轨空白可框选。'}</small></div>
        <TimelineTracks document={document} selectedLineId={selectedLineId ?? null} selectedRomanization={selectedRomanization ?? null} startUs={startUs} endUs={endUs} positionUs={Math.round(position * 1e6)} bpm={bpm} snap={snap}
          visible={visible}
          apply={onTimelineCommand} onSelectLine={onSelectLine} onPan={(nextStartUs) => { setFollow(false); setStart(panViewport({ startUs: 0, spanUs: Math.round(span * 1e6) }, durationUs, nextStartUs).startUs / 1e6); }} onError={setError} />
      </>}
      {visible.spectrum && asset && <SpectrogramCanvas assetIdentity={`${asset.id}:${asset.asset_hash}`} projectId={projectId} startUs={startUs} endUs={endUs} durationUs={durationUs} />}
      </div>
      <div className={styles.controls}>
        <select
          disabled={disabled}
          value={rate}
          onChange={(e) => {
            const n = Number(e.target.value);
            setRate(n);
            if (audio.current) audio.current.playbackRate = n;
          }}
          aria-label="播放速度"
        >
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
          <option value="1.25">1.25×</option>
        </select>
        <button
          disabled={disabled}
          onClick={() => {
            const aUs = Math.round(readPosition() * 1e6);
            try { setLoop(setLoopA(loop, aUs, durationUs)); setError(''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '设置 A 失败'); }
          }}
        >
          A {bandA == null ? "--:--.---" : fmt(bandA)}
        </button>
        <button
          disabled={disabled || loop.aUs == null}
          onClick={() => {
            const bUs = Math.round(readPosition() * 1e6);
            try { setLoop(setLoopB(loop, bUs, durationUs)); setError(''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '设置 B 失败'); }
          }}
        >
          B {bandB == null ? "--:--.---" : fmt(bandB)}
        </button>
        <button
          disabled={
            disabled || loop.aUs == null || loop.bUs == null || loop.bUs <= loop.aUs
          }
          className={loop.enabled ? styles.active : ""}
          onClick={() => setLoop((current) => ({ ...current, enabled: !current.enabled }))}
        >
          循环 A/B
        </button>
        <button disabled={disabled || loop.aUs === null || loop.bUs === null} onClick={() => { if (loop.aUs !== null && loop.bUs !== null) { setFollow(false); setStart(Math.max(0, Math.min(duration - span, loop.aUs / 1e6))); } }}>定位 A/B</button>
        <button
          disabled={disabled || !validLine}
          onClick={() => setLoop(captureLoop(selectedLine!.begin_us!, selectedLine!.end_us!, durationUs))}
        >
          循环当前行
        </button>
        <button
          disabled={disabled || !validUnit}
          onClick={() => setLoop(captureLoop(loopRange!.begin_us, loopRange!.end_us, durationUs))}
        >
          循环当前单元
        </button>
        {error ? (
          <button className={styles.error} onClick={retryMedia}>
            {error} · 重试
          </button>
        ) : !asset ? (
          <span className={styles.note}>未连接媒体</span>
        ) : waveform.isError ? (
          <button className={styles.error} onClick={() => waveform.refetch()}>
            波形加载失败 · 重试
          </button>
        ) : null}
      </div>
      </>}
    </footer>
  );
});
