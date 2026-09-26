import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
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
import { SpectrogramCanvas } from './SpectrogramCanvas';
import { estimateBpm } from '../domain/bpm';

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
  onTimelineCommand?: (command: LyricCommand) => void;
  onSelectLine?: (lineId: string) => void;
};

export type TransportHandle = {
  getPositionUs: () => number;
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
  onTimelineCommand,
  onSelectLine,
}: Props, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const raf = useRef<number | undefined>(undefined);
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
  const [width, setWidth] = useState(640);
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const [loop, setLoop] = useState<"off" | "ab" | "line" | "unit">("off");
  const [error, setError] = useState("");
  const [bpm, setBpm] = useState(120);
  const [snap, setSnap] = useState(true);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [follow, setFollow] = useState(false);
  const [bpmStatus, setBpmStatus] = useState('');
  const tapTimes = useRef<number[]>([]);
  const startUs = Math.round(start * 1e6);
  const end = Math.min(duration, start + span);
  const endUs = Math.round(end * 1e6);
  const level = Math.max(
    0,
    Math.min(
      15,
      Math.ceil(Math.log2((Math.max(1, span) * 100) / Math.max(1, width))),
    ),
  );
  const waveform = useQuery({
    queryKey: ["waveform", projectId, startUs, endUs, level],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      studioApi.getWaveform(projectId, startUs, endUs, level, signal),
    enabled: Boolean(asset) && span > 0 && end > start,
    staleTime: 60000,
  });
  const validLine =
    selectedLine?.begin_us != null &&
    selectedLine.end_us != null &&
    selectedLine.begin_us >= 0 &&
    selectedLine.end_us > selectedLine.begin_us &&
    selectedLine.end_us <= duration * 1e6;
  const lineA = validLine ? selectedLine!.begin_us! / 1e6 : null;
  const lineB = validLine ? selectedLine!.end_us! / 1e6 : null;
  const validUnit = Boolean(
    loopRange &&
      Number.isSafeInteger(loopRange.begin_us) &&
      Number.isSafeInteger(loopRange.end_us) &&
      loopRange.begin_us >= 0 &&
      loopRange.begin_us < loopRange.end_us &&
      loopRange.end_us <= duration * 1e6,
  );
  const activeLoop = useCallback(
    () =>
      loop === "unit" && validUnit && loopRange
        ? ([loopRange.begin_us / 1e6, loopRange.end_us / 1e6] as const)
        : loop === "line" && validLine
          ? ([lineA!, lineB!] as const)
          : loop === "ab" && pointA != null && pointB != null && pointB > pointA
            ? ([pointA, pointB] as const)
            : null,
    [lineA, lineB, loop, loopRange, pointA, pointB, validLine, validUnit],
  );
  const readPosition = useCallback(
    () =>
      audio.current
        ? audio.current.currentTime + offset(asset)
        : positionRef.current,
    [asset],
  );
  const updateDom = useCallback(
    (raw: number) => {
      const current = Math.max(0, Math.min(duration || raw, raw));
      positionRef.current = current;
      if (clock.current)
        clock.current.textContent = `${fmt(current)} / ${fmt(duration)}`;
      slider.current?.setAttribute("aria-valuenow", String(current));
      if (head.current)
        head.current.style.left = `${span ? ((current - start) / span) * 100 : 0}%`;
      if (head.current)
        head.current.style.display =
          current >= start && current <= start + span ? "block" : "none";
      onPosition?.(Math.round(current * 1_000_000));
    },
    [duration, onPosition, span, start],
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
    seekUs: (timeUs) => { auditionEnd.current = null; seekTo(timeUs / 1_000_000); },
    play: () => { if (audio.current?.paused) play(); },
    pause: () => audio.current?.pause(),
    audition: (beginUs, endUs) => {
      if (!asset || endUs <= beginUs) return;
      setLoop('off');
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
    setPointA(null);
    setPointB(null);
    setLoop("off");
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
    const onPause = () => {
      setPlaying(false);
      sync();
    };
    el.addEventListener("loadedmetadata", metadata);
    el.addEventListener("timeupdate", sync);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    el.addEventListener("ended", ended);
    sync();
    return () => {
      el.removeEventListener("loadedmetadata", metadata);
      el.removeEventListener("timeupdate", sync);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
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
      if (follow && span < duration && current > start + span * 0.85 && current < duration) {
        setStart(Math.min(duration - span, Math.max(0, current - span * 0.3)));
      }
      if (auditionEnd.current !== null && current >= auditionEnd.current) {
        auditionEnd.current = null;
        el.pause();
        return;
      }
      const range = activeLoop();
      if (range && current >= range[1]) {
        el.currentTime = Math.max(0, range[0] - offset(asset));
        updateDom(range[0]);
      }
      if (!el.paused) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current ?? 0);
  }, [activeLoop, asset, duration, follow, playing, readPosition, span, start, updateDom]);

  useEffect(() => {
    if ((loop === "line" && !validLine) || (loop === "unit" && !validUnit))
      setLoop("off");
  }, [loop, validLine, validUnit]);

  useEffect(() => {
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
      const scale = devicePixelRatio || 1;
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
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            setWidth(c.clientWidth);
            draw();
          });
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [endUs, startUs, waveform.data, width]);
  const setView = (next: number, center: number) => {
    const minSpan = Math.min(1, duration || next);
    const s = Math.max(minSpan, Math.min(duration || next, next));
    setSpan(s);
    setStart(Math.max(0, Math.min(Math.max(0, duration - s), center - s / 2)));
  };
  const move = (direction: number) =>
    setStart((v) =>
      Math.max(
        0,
        Math.min(
          Math.max(0, duration - span),
          v + direction * Math.max(1, span * 0.8),
        ),
      ),
    );
  const seekClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(start + ((e.clientX - r.left) / r.width) * span);
  };
  const wheelView = (event: WheelEvent<HTMLDivElement>) => {
    if (!asset) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const center = start + (event.clientX - rect.left) / rect.width * span;
      setView(span * (event.deltaY > 0 ? 1.25 : 0.8), center);
    } else {
      setStart((value) => Math.max(0, Math.min(duration - span, value + Math.sign(event.deltaY || event.deltaX) * span * 0.2)));
    }
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
  const bandA = loop === "line" ? lineA : pointA;
  const bandB = loop === "line" ? lineB : pointB;
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
  const tickStep = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((value) => span / value <= 12) ?? 600;
  const ticks = span > 0 ? Array.from({ length: Math.min(13, Math.floor(end / tickStep) - Math.ceil(start / tickStep) + 1) }, (_, index) => (Math.ceil(start / tickStep) + index) * tickStep) : [];
  return (
    <footer className={styles.footer} onKeyDown={keyDown}>
      <audio
        ref={audio}
        preload="metadata"
        src={asset ? studioApi.audioUrl(projectId) : undefined}
      />
      <div className={styles.header}>
        <span>
          {fmt(start)} – {fmt(end)}
        </span>
        <button
          disabled={disabled}
          onClick={() => setView(duration, positionRef.current)}
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
      </div>
      <div className={styles.ruler} aria-label="时间标尺">{ticks.map((time) => <span key={time} style={{ left: `${(time - start) / span * 100}%` }}>{fmt(time)}</span>)}</div>
      <div
        ref={slider}
        className={styles.waveWrap}
        onWheel={wheelView}
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
          onClick={disabled ? undefined : seekClick}
        />
        <span ref={head} className={styles.head} />
        {snap && Array.from({ length: beatCount }, (_, index) => <span key={index} className={styles.beatLine} style={{ left: `${((firstBeat + index) * beatUs - startUs) / (endUs - startUs) * 100}%` }} />)}
        {bandA != null && bandB != null && bandB > bandA && (
          <span
            className={styles.band}
            style={{
              left: `${((bandA - start) / span) * 100}%`,
              width: `${((bandB - bandA) / span) * 100}%`,
            }}
          />
        )}
      </div>
      {document && onTimelineCommand && onSelectLine && <>
        <div className={styles.timelineTools}><strong>时间轴</strong><label>BPM <input type="number" min="30" max="300" value={bpm} onChange={(event) => { const value = Number(event.target.value); if (value >= 30 && value <= 300) setBpm(value); }} /></label>
          <button onClick={tapBpm}>Tap</button><button disabled={!asset} onClick={() => void autoBpm()}>自动 BPM</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 吸附</label><label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> 播放跟随</label><small>{bpmStatus || '拖动色块移动；拖边界调整；在词轨空白处拖出选区。空隙可点击闭合。'}</small></div>
        <TimelineTracks document={document} selectedLineId={selectedLineId ?? null} startUs={startUs} endUs={endUs} positionUs={Math.round(position * 1e6)} bpm={bpm} snap={snap}
          apply={onTimelineCommand} onSelectLine={onSelectLine} onError={setError} />
      </>}
      {showSpectrum && asset && <SpectrogramCanvas projectId={projectId} startUs={startUs} endUs={endUs} durationUs={Math.round(duration * 1e6)} />}
      <div className={styles.controls}>
        <button
          className={styles.play}
          disabled={disabled}
          aria-label={playing ? "暂停" : "播放"}
          onClick={play}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <span ref={clock}>
          {fmt(position)} / {fmt(duration)}
        </span>
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
            const p = readPosition();
            setPointA(p);
            if (pointB != null && pointB <= p) setPointB(null);
          }}
        >
          A {pointA == null ? "--:--.---" : fmt(pointA)}
        </button>
        <button
          disabled={disabled || pointA == null}
          onClick={() => {
            const p = readPosition();
            if (pointA != null && p > pointA) setPointB(p);
          }}
        >
          B {pointB == null ? "--:--.---" : fmt(pointB)}
        </button>
        <button
          disabled={
            disabled || pointA == null || pointB == null || pointB <= pointA
          }
          className={loop === "ab" ? styles.active : ""}
          onClick={() => setLoop(loop === "ab" ? "off" : "ab")}
        >
          循环 A/B
        </button>
        <button
          disabled={disabled || !validLine}
          className={loop === "line" ? styles.active : ""}
          onClick={() => setLoop(loop === "line" ? "off" : "line")}
        >
          循环当前行
        </button>
        <button
          disabled={disabled || !validUnit}
          className={loop === "unit" ? styles.active : ""}
          onClick={() => setLoop(loop === "unit" ? "off" : "unit")}
        >
          循环当前单元
        </button>
        <button
          disabled={disabled}
          aria-label="放大波形"
          onClick={() => setView(span / 2, positionRef.current)}
        >
          ＋
        </button>
        <button
          disabled={disabled}
          aria-label="缩小波形"
          onClick={() =>
            setView(Math.min(duration || span, span * 2), positionRef.current)
          }
        >
          −
        </button>
        <button disabled={disabled} className={showSpectrum ? styles.active : ''} onClick={() => setShowSpectrum((value) => !value)}>频谱</button>
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
    </footer>
  );
});
