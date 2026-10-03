import { Select } from '../shared/Select';
import { useAudioReview } from './AudioReviewContext';
import { createPortal } from 'react-dom';
import { VocalTracks } from './VocalTracks';
import { vocalApi } from '../adapters/http/client';
import type { Acoustics, VocalSegment } from '../domain/project-document';
import { IconButton } from '../shared/Controls';
import { matchesBinding, shortcutInput, useShortcuts } from './shortcuts';
import { PlaybackSpeed } from './PlaybackSpeed';
import { normalizePlaybackSpeed, playbackSpeedKey, savedPlaybackSpeed } from '../domain/playback-speed';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
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
const offset = (asset: Asset | null) => (asset?.proxy_offset_ms ?? 0) / 1e3;
type Props = {
  timelineHost?: HTMLDivElement | null;
  acoustics?: Acoustics;
  onAcoustics?: (acoustics: Acoustics) => void;
  onAssign?: (lineId: string, segment: VocalSegment) => void;
  projectId: string;
  selectedLine?: { begin_ms: number | null; end_ms: number | null };
  asset: Asset | null;
  loopRange?: { begin_ms: number; end_ms: number };
  onPosition?: (positionMs: number) => void;
  document?: LyricDocument;
  selectedLineId?: string | null;
  selectedRomanization?: { trackId: string; contentId: string } | null;
  onTimelineCommand?: (command: LyricCommand) => void;
  onSelectLine?: (lineId: string) => void;
};

export type TransportHandle = {
  getPositionMs: () => number;
  getPlaybackRate: () => number;
  isPlaying: () => boolean;
  seekMs: (timeMs: number) => void;
  play: () => void;
  pause: () => void;
  audition: (beginMs: number, endMs: number) => void;
};

export const MediaTransport = forwardRef<TransportHandle, Props>(function MediaTransport({
  timelineHost, acoustics, onAcoustics, onAssign,
  projectId,
  selectedLine,
  asset,
  loopRange: lyricLoopRange,
  onPosition,
  document,
  selectedLineId,
  selectedRomanization,
  onTimelineCommand,
  onSelectLine,
}: Props, ref) {
  const ui=useAudioReview();
  const segment=ui?.selected.length===1?acoustics?.segments.find(s=>s.id===ui.selected[0]):undefined;
  const loopRange=ui?.segmentTarget?(segment?{begin_ms:segment.beginMs,end_ms:segment.endMs}:undefined):lyricLoopRange;
  const plotsRef=useRef<HTMLDivElement>(null);
  const keys = useShortcuts();
  const results = useQuery({ queryKey:['vocals',projectId], queryFn:()=>vocalApi.list(projectId), refetchInterval:3000, enabled:!!asset });
  const sourceResults = results.data?.items.filter(r=>r.source_asset_id===asset?.id && r.audio_state!=='missing') ?? [];
  const vocalId = (sourceResults.find(r=>r.audio_state==='current') ?? sourceResults[0])?.audio_id ?? null;
  const [playbackChoice,setPlaybackChoice] = useState(false);
  const [graphicChoice,setGraphicChoice] = useState(true);
  const [playbackVocal,setPlaybackVocal] = useState<string|null>(null);
  const graphicVocal = graphicChoice ? vocalId : null;
  const switching = useRef<{position:number;playing:boolean} | null>(null);
  const [loadingSource,setLoadingSource] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(()=>{
    const next = playbackChoice ? vocalId : null;
    if(next===playbackVocal) return;
    const el=audio.current;
    switching.current={position:el?.currentTime??0,playing:!!el&&!el.paused};
    el?.pause();setLoadingSource(true);setPlaybackVocal(next);
  },[playbackChoice,vocalId,playbackVocal]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const raf = useRef<number | undefined>(undefined);
  const moveAnimation = useRef<number | null>(null);
  const panDrag = useRef<{ x: number; startMs: number; left: number; width: number; pointerId: number; started: boolean } | null>(null);
  const loopDrag = useRef<{ side: 'a' | 'b'; original: LoopState; left: number; width: number; pointerId: number } | null>(null);
  const lastTrackPaint = useRef(0);
  const lastFollowPaint = useRef(0);
  const positionRef = useRef(0);
  const auditionEnd = useRef<number | null>(null);
  const [duration, setDuration] = useState(
    asset?.duration_ms ? asset.duration_ms / 1e3 : 0,
  );
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(savedPlaybackSpeed);
  const changeRate = useCallback((value: number) => {
    const next = normalizePlaybackSpeed(value);
    setRate(next); localStorage.setItem(playbackSpeedKey, String(next));
    if (audio.current) { audio.current.preservesPitch = true; audio.current.playbackRate = next; }
  }, []);
  const [start, setStart] = useState(0);
  const [span, setSpan] = useState(0);

  const [loop, setLoop] = useState<LoopState>(emptyLoop);
  const [error, setError] = useState("");
  const [bpm, setBpm] = useState(120);
  const [snap, setSnap] = useState(true);
  const [bottomExpanded, setExpanded] = useState(true);
  const expanded = !!timelineHost || bottomExpanded;
  const [visible, setVisible] = useState({ line: true, word: true, ruby: true, gap: true, spectrum: false, wave: true, energy:true, segments:true });
  const { width, ratio } = useCanvasMetrics(canvas, expanded, timelineHost);
  const [follow, setFollow] = useState(false);
  const viewportRef = useRef({ start, span, duration, follow });
  viewportRef.current = { start, span, duration, follow };
  const [bpmStatus, setBpmStatus] = useState('');
  useEffect(() => () => { if (moveAnimation.current !== null) cancelAnimationFrame(moveAnimation.current); }, []);
  const tapTimes = useRef<number[]>([]);
  const startMs = Math.round(start * 1e3);
  const end = Math.min(duration, start + span);
  const endMs = Math.round(end * 1e3);
  const durationMs = Math.round(duration * 1e3);
  const requestWindow = waveformRequestWindow({ startMs, spanMs: Math.round(span * 1e3) }, durationMs);
  const level = Math.max(
    0,
    Math.min(
      15,
      Math.ceil(Math.log2((Math.max(1, span) * 100) / Math.max(1, width))),
    ),
  );
  const waveform = useQuery({
    queryKey: ["waveform", projectId, graphicVocal, requestWindow.startMs, requestWindow.endMs, level],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      studioApi.getWaveform(projectId, requestWindow.startMs, requestWindow.endMs, level, signal, graphicVocal),
    enabled: Boolean(asset) && expanded && span > 0 && end > start,
    staleTime: Infinity, gcTime: 0, retry: false,
    placeholderData: (data, query) => query?.queryKey[1] === projectId && query.queryKey[2] === graphicVocal && query.queryKey[5] === level ? data : undefined,
  });
  const validLine =
    selectedLine?.begin_ms != null &&
    selectedLine.end_ms != null &&
    selectedLine.begin_ms >= 0 &&
    selectedLine.end_ms > selectedLine.begin_ms &&
    selectedLine.end_ms <= durationMs;
  const validUnit = Boolean(
    loopRange &&
      Number.isSafeInteger(loopRange.begin_ms) &&
      Number.isSafeInteger(loopRange.end_ms) &&
      loopRange.begin_ms >= 0 &&
      loopRange.begin_ms < loopRange.end_ms &&
      loopRange.end_ms <= durationMs,
  );
  const activeLoop = useCallback(() => {
    const range = activeLoopRange(loop, durationMs);
    return range ? [range[0] / 1e3, range[1] / 1e3] as const : null;
  }, [durationMs, loop]);
  const readPosition = useCallback(
    () =>
      audio.current
        ? audio.current.currentTime + offset(asset)
        : positionRef.current,
    [asset],
  );
  const projectHead = useCallback((current: number) => {
    const { start, span } = viewportRef.current;
    if (!head.current) return;
    head.current.style.left = `${span ? (current - start) / span * 100 : 0}%`;
    head.current.style.display = current >= start && current <= start + span ? 'block' : 'none';
  }, []);
  useLayoutEffect(() => { projectHead(readPosition()); }, [start, span, expanded, readPosition, projectHead]);
  const updateDom = useCallback(
    (raw: number) => {
      const { duration: mediaDuration } = viewportRef.current;
      const current = Math.max(0, Math.min(mediaDuration || raw, raw));
      positionRef.current = current;
      if (clock.current)
        clock.current.textContent = `${fmt(current)} / ${fmt(mediaDuration)}`;
      slider.current?.setAttribute("aria-valuenow", String(current));
      projectHead(current);
      onPosition?.(Math.round(current * 1_000));
    },
    [onPosition, projectHead],
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
    getPositionMs: () => Math.round(readPosition() * 1_000),
    getPlaybackRate: () => audio.current?.playbackRate ?? rate,
    isPlaying: () => Boolean(audio.current && !audio.current.paused),
    seekMs: (timeMs) => { auditionEnd.current = null; seekTo(timeMs / 1_000); },
    play: () => { if (audio.current?.paused) play(); },
    pause: () => audio.current?.pause(),
    audition: (beginMs, endMs) => {
      if (!asset || endMs <= beginMs) return;
      seekTo(beginMs / 1_000);
      auditionEnd.current = endMs / 1_000;
      if (audio.current?.paused) play();
    },
  }), [asset, play, seekTo, readPosition, rate]);

  useEffect(() => {
    const d = asset?.duration_ms ? asset.duration_ms / 1e3 : 0;
    setDuration(d);
    setSpan(d);
    setStart(0);
    setPosition(0);
    positionRef.current = 0;
    setLoop(emptyLoop());
    setPlaying(false);
  }, [asset?.id, asset?.duration_ms]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const sync = () => updateDom(readPosition());
    const metadata = () => {
      setError('');
      if (!asset?.duration_ms && Number.isFinite(el.duration))
        setDuration(el.duration);
      if (!asset?.duration_ms && Number.isFinite(el.duration))
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
    const onError = () => { setLoadingSource(false); setError("所选音源无法播放，请重试"); };
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
      if (view.follow && view.span < view.duration && performance.now() - lastFollowPaint.current >= 32) {
        const target = Math.max(0, Math.min(view.duration - view.span, current - view.span * 0.35));
        const elapsed = Math.min(100, performance.now() - lastFollowPaint.current);
        lastFollowPaint.current = performance.now();
        const blend = 1 - Math.exp(-elapsed / 130);
        setStart((value) => Math.abs(target - value) < 0.001 ? target : value + (target - value) * blend);
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
    if (audio.current) { audio.current.preservesPitch = true; audio.current.playbackRate = rate; }
  }, [rate, asset?.id, projectId]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const draw = () => {
      const r = c.getBoundingClientRect();
      const scale = ratio;
      const pixelWidth = Math.max(1, Math.round(r.width * scale));
      const pixelHeight = Math.max(1, Math.round(r.height * scale));
      if (c.width !== pixelWidth) c.width = pixelWidth;
      if (c.height !== pixelHeight) c.height = pixelHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const d = waveform.data;
      if (!d || endMs <= startMs) return;
      ctx.strokeStyle = "#91aee4";
      const view = endMs - startMs;
      ctx.beginPath();
      d.maximum.forEach((max, i) => {
        if (d.start_ms + (i + 1) * d.bucket_ms < startMs || d.start_ms + i * d.bucket_ms > endMs) return;
        const min = d.minimum[i] ?? max;
        const x =
          ((d.start_ms + i * d.bucket_ms - startMs) / view) * r.width +
          Math.max(1, (d.bucket_ms / view) * r.width) / 2;
        ctx.moveTo(Math.round(x) + 0.5, ((1 - max) * r.height) / 2);
        ctx.lineTo(Math.round(x) + 0.5, ((1 - min) * r.height) / 2);
      });
      ctx.stroke();
    };
    draw();
  }, [endMs, startMs, waveform.data, width, ratio, timelineHost]);
  const zoomAt = (factor: number, fraction: number) => {
    if (moveAnimation.current !== null) { cancelAnimationFrame(moveAnimation.current); moveAnimation.current = null; }
    const next = zoomViewport({ startMs, spanMs: Math.round(span * 1e3) }, durationMs, factor, fraction);
    if (next.startMs === startMs && next.spanMs === Math.round(span * 1e3)) return false;
    setFollow(false);
    setStart(next.startMs / 1e3);
    setSpan(next.spanMs / 1e3);
    return true;
  };
  const move = (direction: number) => {
    if (moveAnimation.current !== null) cancelAnimationFrame(moveAnimation.current);
    setFollow(false);
    const from = startMs;
    const to = panViewport({ startMs, spanMs: Math.round(span * 1e3) }, durationMs, direction * Math.max(20, Math.round(span * 100))).startMs;
    const began = performance.now();
    const frame = (now: number) => {
      const fraction = Math.min(1, (now - began) / 180);
      const eased = 1 - (1 - fraction) ** 3;
      setStart((from + (to - from) * eased) / 1e3);
      moveAnimation.current = fraction < 1 ? requestAnimationFrame(frame) : null;
    };
    moveAnimation.current = requestAnimationFrame(frame);
  };
  useEffect(()=>{
    const node=plotsRef.current;if(!node)return;
    const wheel=(event:globalThis.WheelEvent)=>{
      if(!asset||event.ctrlKey||event.metaKey||ui?.adding)return;
      const target=event.target as Element;
      if(!target.closest('[data-wheel-zoom]')||target.closest('input,select,button,[role="combobox"]'))return;
      event.preventDefault();
      const rect=slider.current!.getBoundingClientRect();
      const delta=(event.deltaY||event.deltaX)*(event.deltaMode===1?16:event.deltaMode===2?rect.height:1);
      zoomAt(Math.exp(delta*.001),(event.clientX-rect.left)/rect.width);
    };
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>node.removeEventListener('wheel',wheel);
  });
  const beginPan = (event: PointerEvent<HTMLElement>) => {
    if (ui?.adding || !asset || event.button !== 0 || (event.target as Element).closest('[data-loop-handle]')) return;
    if (moveAnimation.current !== null) { cancelAnimationFrame(moveAnimation.current); moveAnimation.current = null; }
    const rect = event.currentTarget.getBoundingClientRect();
    panDrag.current = { x: event.clientX, startMs, left: rect.left, width: rect.width, pointerId: event.pointerId, started: false };
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
    const next = panViewport({ startMs: current.startMs, spanMs: Math.round(span * 1e3) }, durationMs, -(event.clientX - current.x) / current.width * span * 1e3);
    setStart(next.startMs / 1e3);
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
    if (!current || current.pointerId !== event.pointerId || loop.aMs === null || loop.bMs === null) return;
    event.preventDefault(); event.stopPropagation();
    const value = Math.round(startMs + (event.clientX - current.left) / current.width * span * 1e3);
    setLoop((state) => current.side === 'a'
      ? { ...state, aMs: Math.max(0, Math.min(state.bMs! - 1, value)) }
      : { ...state, bMs: Math.min(durationMs, Math.max(state.aMs! + 1, value)) });
  };
  const endLoopDrag = (event: PointerEvent<HTMLSpanElement>, cancel = false) => {
    const current = loopDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (cancel) setLoop(current.original);
    loopDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && (panDrag.current || loopDrag.current)) {
      if (panDrag.current) setStart(panDrag.current.startMs / 1e3);
      if (loopDrag.current) setLoop(loopDrag.current.original);
      panDrag.current = null; loopDrag.current = null;
      e.preventDefault(); return;
    }
    if (
      !asset || e.defaultPrevented ||
      e.nativeEvent.isComposing ||
      e.repeat ||
      shortcutInput(e.target)
    )
      return;
    const action = (['seekStart', 'seekEnd', 'seekBack', 'seekForward'] as const).find(action => matchesBinding(e.nativeEvent, keys[action]));
    if (action) {
      e.preventDefault();
      seekTo(action === 'seekStart' ? 0 : action === 'seekEnd' ? duration : readPosition() + (action === 'seekForward' ? 1 : -1));
    }
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && (panDrag.current || loopDrag.current)) {
        if (panDrag.current) setStart(panDrag.current.startMs / 1e3);
        if (loopDrag.current) setLoop(loopDrag.current.original);
        panDrag.current = null; loopDrag.current = null;
        e.preventDefault(); return;
      }
      if (
        matchesBinding(e, keys.play) &&
        !e.defaultPrevented &&
        !e.isComposing &&
        !e.repeat &&
        asset &&
        !shortcutInput(e.target)
      ) {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, play, keys]);
  const disabled = !asset;
  const retryMedia = () => {
    audio.current?.load();
    play();
  };
  const bandA = loop.aMs === null ? null : loop.aMs / 1e3;
  const bandB = loop.bMs === null ? null : loop.bMs / 1e3;

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
      const window = await studioApi.getWaveform(projectId, 0, Math.min(Math.round(duration * 1e3), 20_000), 0);
      const result = estimateBpm(window.minimum, window.maximum, window.bucket_ms);
      if (result === null) { setBpmStatus('未检测到稳定节拍'); return; }
      setBpm(result);
      setBpmStatus(`检测到 ${result} BPM`);
    } catch {
      setBpmStatus('BPM 分析失败');
    }
  };
  const beatMs = 60_000 / bpm;
  const firstBeat = Math.ceil(startMs / beatMs);
  const beatCount = bpm > 0 && endMs > startMs ? Math.max(0, Math.min(500, Math.floor((endMs - firstBeat * beatMs) / beatMs) + 1)) : 0;
  const maxTicks = Math.max(2, Math.floor(width / 82));
  const tickStep = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((value) => span / value <= maxTicks) ?? 600;
  const ticks = span > 0 ? Array.from({ length: Math.min(maxTicks + 1, Math.max(0, Math.floor(end / tickStep) - Math.ceil(start / tickStep) + 1)) }, (_, index) => (Math.ceil(start / tickStep) + index) * tickStep) : [];
  const viewportTools = (<>
        <button data-role="secondary"
          disabled={disabled}
          onClick={() => { setFollow(false); setStart(0); setSpan(duration); }}
        >
          全曲
        </button>
        <IconButton data-role="secondary" disabled={disabled} icon="back" label="前移窗口" onClick={() => move(-1)}/>
        <IconButton data-role="secondary" disabled={disabled} icon="chevron" label="后移窗口" onClick={() => move(1)}/>
        <IconButton data-role="secondary" disabled={disabled} icon="add" label="放大波形" onClick={() => zoomAt(0.5, span ? (positionRef.current - start) / span : 0.5)}/>
        <IconButton data-role="secondary" disabled={disabled} icon="minus" label="缩小波形" onClick={() => zoomAt(2, span ? (positionRef.current - start) / span : 0.5)}/>
        <span className={styles.viewportRange}>视窗 {fmt(start)} – {fmt(end)}</span>
        <div className={styles.visibility} aria-label="时间轴图层">
          {(['line', 'word', 'ruby', 'gap', 'wave', 'spectrum', ...(timelineHost?['energy','segments'] as const:[])] as const).map((key) => <button data-role="secondary" key={key} className={visible[key] ? styles.active : ''} aria-pressed={visible[key]} onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}>
            {({ line: '行', word: '词', ruby: '注音', gap: '空隙', wave: '波形', spectrum: '声谱图', energy:'能量',segments:'片段' })[key]}
          </button>)}
        </div>
</>);
  const acousticPlots=(<div>
      <div className={styles.ruler} aria-label="时间标尺" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={() => { panDrag.current = null; }}>{ticks.map((time) => <span data-tick-ms={Math.round(time * 1e3)} key={time} style={{ left: `${(time - start) / span * 100}%` }}>{fmt(time)}</span>)}</div>
      <div className={styles.waveRow}>
        <div className={styles.sourceLabel}><Select aria-label="波形／声谱图音源" title="波形／声谱图音源" value={graphicVocal?'vocal':''} onChange={e=>setGraphicChoice(e.target.value==='vocal')}><option value="">原曲</option>{vocalId && <option value="vocal">人声</option>}</Select></div>
      <div
        data-wheel-zoom ref={slider}
        className={styles.waveWrap}
        style={visible.wave || ui?.adding ? undefined : { height: 0, overflow: 'hidden', border: 0, minHeight: 0 }}
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
        {snap && span <= 30 && Array.from({ length: beatCount }, (_, index) => <span key={index} className={styles.beatLine} style={{ left: `${((firstBeat + index) * beatMs - startMs) / (endMs - startMs) * 100}%` }} />)}
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
      </div></div>
  </div>);
  const plots = (
      <div id="timeline-plots" ref={plotsRef} className={styles.timelinePlots}>
        <div className={styles.timelineTools}><strong>时间轴</strong><label>BPM <input type="number" min="30" max="300" value={bpm} onChange={(event) => { const value = Number(event.target.value); if (value >= 30 && value <= 300) setBpm(value); }} /></label>
          <button data-role="secondary" onClick={tapBpm}>Tap</button><button data-role="secondary" disabled={!asset} onClick={() => void autoBpm()}>自动 BPM</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 吸附</label><label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> 播放跟随</label>{bpmStatus && <small role="status">{bpmStatus}</small>}</div>
      {timelineHost && <div className={styles.header}>{viewportTools}</div>}

      {timelineHost && acoustics && onAcoustics && onAssign ? <VocalTracks projectId={projectId} acoustics={acoustics} startMs={startMs} endMs={endMs} durationMs={durationMs} positionMs={Math.round(position*1000)} selectedLineId={selectedLineId??null} lineLabel={selectedLineId?`L${(document?.lines.filter(l=>!l.backgroundOf).findIndex(l=>l.id===(document.lines.find(l=>l.id===selectedLineId)?.backgroundOf??selectedLineId))??-1)+1}${document?.lines.find(l=>l.id===selectedLineId)?.backgroundOf?' 背景':''}`:''} apply={onAcoustics} assign={onAssign} pause={()=>audio.current?.pause()} bpm={bpm} snap={snap} anchors={document?.lines.flatMap(l=>[l,...l.words,...l.words.flatMap(w=>w.rubyUnits)]).flatMap(u=>[u.beginMs,u.endMs]).filter((t):t is number=>t!==null&&t>=startMs&&t<=endMs)??[]} showEnergy={visible.energy} showSegments={visible.segments}>{acousticPlots}</VocalTracks>:acousticPlots}
      {document && onTimelineCommand && onSelectLine && <>

        <TimelineTracks document={document} selectedLineId={selectedLineId ?? null} selectedRomanization={selectedRomanization ?? null} startMs={startMs} endMs={endMs} positionMs={Math.round(position * 1e3)} bpm={bpm} snap={snap}
          visible={visible}
          apply={onTimelineCommand} onSelectLine={id=>{ui?.setSegmentTarget(false);onSelectLine(id);}} onPan={(nextStartMs) => { setFollow(false); setStart(panViewport({ startMs: 0, spanMs: Math.round(span * 1e3) }, durationMs, nextStartMs).startMs / 1e3); }} onError={setError} />
      </>}
      {visible.spectrum && asset && <SpectrogramCanvas vocal={graphicVocal} assetIdentity={`${asset.id}:${asset.asset_hash}:${graphicVocal}`} projectId={projectId} startMs={startMs} endMs={endMs} durationMs={durationMs} />}
      </div>
  );
  return (
    <footer data-transport className={`${styles.footer} ${expanded && !timelineHost ? styles.expanded : styles.collapsed}`} onKeyDown={keyDown}>
      <audio
        ref={audio}
        onLoadedMetadata={() => { if (audio.current) { audio.current.preservesPitch = true; audio.current.playbackRate = rate; const captured=switching.current; if(captured){audio.current.currentTime=captured.position; switching.current=null;setLoadingSource(false);if(captured.playing)void audio.current.play().catch(e=>{if(e.name!=='AbortError')setError('所选音源无法播放，请重试');});} } }}
        preload="metadata"
        src={asset ? studioApi.audioUrl(projectId, playbackVocal) : undefined}
      />
      <div className={styles.header}>
        <IconButton data-role="secondary" className={styles.play} disabled={disabled} icon={playing ? 'pause' : 'play'} label={playing ? '暂停' : '播放'} onClick={play}/>
        <span ref={clock}>{fmt(position)} / {fmt(duration)}</span>
        <label>播放音源 <Select aria-label="播放音源" value={playbackVocal?'vocal':''} onChange={e=>setPlaybackChoice(e.target.value==='vocal')}><option value="">原曲</option>{vocalId && <option value="vocal">人声</option>}</Select></label>
        {loadingSource&&<span role="status">正在加载音源…</span>}
        {expanded && !timelineHost && viewportTools}
        {!timelineHost && <button data-role="secondary" className={`icon-button ${styles.timelineToggle}`} aria-label={expanded ? "收起时间轴" : "展开时间轴"} title={expanded ? "收起时间轴" : "展开时间轴"} aria-expanded={expanded} aria-controls="timeline-plots" onClick={() => setExpanded(value => !value)}>
          <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d={expanded ? "M1 1h10L6 7z" : "M1 7h10L6 1z"} fill="currentColor" /></svg>
        </button>}
      </div>
      {expanded && <>
      {timelineHost ? createPortal(plots, timelineHost) : plots}
      <div className={styles.controls}>
        <PlaybackSpeed rate={rate} disabled={disabled} change={changeRate} />
        <button data-role="secondary"
          disabled={disabled}
          onClick={() => {
            const aMs = Math.round(readPosition() * 1e3);
            try { setLoop(setLoopA(loop, aMs, durationMs)); setError(''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '设置 A 失败'); }
          }}
        >
          A {bandA == null ? "--:--.---" : fmt(bandA)}
        </button>
        <button data-role="secondary"
          disabled={disabled || loop.aMs == null}
          onClick={() => {
            const bMs = Math.round(readPosition() * 1e3);
            try { setLoop(setLoopB(loop, bMs, durationMs)); setError(''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '设置 B 失败'); }
          }}
        >
          B {bandB == null ? "--:--.---" : fmt(bandB)}
        </button>
        <button data-role="secondary"
          disabled={
            disabled || loop.aMs == null || loop.bMs == null || loop.bMs <= loop.aMs
          }
          className={loop.enabled ? styles.active : ""}
          onClick={() => setLoop((current) => ({ ...current, enabled: !current.enabled }))}
        >
          循环 A/B
        </button>
        <button data-role="secondary" disabled={disabled || loop.aMs === null || loop.bMs === null} onClick={() => { if (loop.aMs !== null && loop.bMs !== null) { setFollow(false); setStart(Math.max(0, Math.min(duration - span, loop.aMs / 1e3))); } }}>定位 A/B</button>
        <button data-role="secondary"
          disabled={disabled || !validLine}
          onClick={() => setLoop(captureLoop(selectedLine!.begin_ms!, selectedLine!.end_ms!, durationMs))}
        >
          循环当前行
        </button>
        <button data-role="secondary"
          disabled={disabled || !validUnit}
          onClick={() => setLoop(captureLoop(loopRange!.begin_ms, loopRange!.end_ms, durationMs))}
        >
          循环当前单元
        </button>
        {error ? (
          <button data-role="secondary" className={styles.error} onClick={retryMedia}>
            {error} · 重试
          </button>
        ) : !asset ? (
          <span className={styles.note}>未连接媒体</span>
        ) : waveform.isError ? (
          <button data-role="secondary" className={styles.error} onClick={() => waveform.refetch()}>
            波形加载失败 · 重试
          </button>
        ) : null}
      </div>
      </>}
    </footer>
  );
});
