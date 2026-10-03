import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument, LyricWord } from '../domain/lyric-document';
import { moveTimeline, resizeTimeline, snapTime, type TimelineTarget } from '../domain/timeline-editing';
import { packIntervals } from '../domain/pack-intervals';
import styles from './media.module.css';

type Props = { document: LyricDocument; selectedLineId: string | null; selectedRomanization: { trackId: string; contentId: string } | null; startMs: number; endMs: number; positionMs: number; bpm: number; snap: boolean;
  visible: { line: boolean; word: boolean; ruby: boolean; gap: boolean };
  apply: (command: LyricCommand) => void; onSelectLine: (lineId: string) => void; onPan: (startMs: number) => void; onError: (message: string) => void };
type Drag = { target: TimelineTarget | null; side: 'move' | 'beginMs' | 'endMs' | 'select' | 'pan'; x: number; current: number; width: number; originalMs: number };
const timed = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

export function TimelineTracks({ document, selectedLineId, selectedRomanization, startMs, endMs, positionMs, bpm, snap, visible, apply, onSelectLine, onPan, onError }: Props) {
  const tracksRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(640);
  useEffect(() => {
    const lane = tracksRef.current!.querySelector('[data-track-lane]');
    if (!lane) return;
    const observer = new ResizeObserver(() => setPlotWidth(lane.getBoundingClientRect().width));
    observer.observe(lane); return () => observer.disconnect();
  }, [visible.line, visible.word, visible.ruby]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { dragRef.current = null; setDrag(null); } };
    window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel);
  }, []);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const propsEndMs = endMs;
  const spanMs = Math.max(1, endMs - startMs);
  const mainLines = document.lines.filter((item) => !item.backgroundOf);
  const ordinalById = new Map(mainLines.map((item, index) => [item.id, index + 1]));
  const line = document.lines.find((item) => item.id === selectedLineId && !item.backgroundOf) ?? document.lines.find((item) => !item.backgroundOf);
  const romanTrack = document.romanizationTracks.find((track) => track.id === selectedRomanization?.trackId);
  const romanContent = romanTrack?.contents.find((content) => content.id === selectedRomanization?.contentId && content.lineId === line?.id);
  const intersects = (begin: number | null, end: number | null) => timed(begin, end) && end! > startMs && begin! < endMs;
  const overview = mainLines.filter(item => intersects(item.beginMs, item.endMs));
  const backgrounds = document.lines.filter(item => item.backgroundOf && intersects(item.beginMs, item.endMs));
  const words = line?.words.filter(word => intersects(word.beginMs, word.endMs)) ?? [];
  const rubies = line?.words.flatMap(word => word.rubyUnits.filter(unit => intersects(unit.beginMs, unit.endMs)).map(unit => ({ word, unit }))) ?? [];
  const currentLayouts = useMemo(() => ({
    line: packIntervals(overview.map(item => ({ key: item.id, beginMs: item.beginMs!, endMs: item.endMs! }))),
    word: packIntervals(words.map(item => ({ key: item.id, beginMs: item.beginMs!, endMs: item.endMs! }))),
    ruby: packIntervals(rubies.map(({ unit }) => ({ key: unit.id, beginMs: unit.beginMs!, endMs: unit.endMs! }))),
  }), [document, line, startMs, endMs]);
  const frozenLayouts = useRef(currentLayouts);
  const editing = drag && !['pan', 'select'].includes(drag.side);
  if (!editing) frozenLayouts.current = currentLayouts;
  const { line: lineLayout, word: wordLayout, ruby: rubyLayout } = editing ? frozenLayouts.current : currentLayouts;
  const gaps = line?.words.flatMap((word, index) => {
    const right = line.words[index + 1];
    return right && word.endMs !== null && right.beginMs !== null && word.endMs !== right.beginMs ? [{ left: word, right, beginMs: Math.min(word.endMs, right.beginMs), endMs: Math.max(word.endMs, right.beginMs), overlap: word.endMs > right.beginMs }] : [];
  }) ?? [];
  const anchors = useMemo(() => {
    const values = document.lines.flatMap((item) => [item.beginMs, item.endMs, ...item.words.flatMap((word) => [word.beginMs, word.endMs, ...word.rubyUnits.flatMap((unit) => [unit.beginMs, unit.endMs])])]).filter((value): value is number => value !== null && value >= startMs && value <= endMs);
    if (bpm > 0) {
      const beat = 60_000 / bpm;
      for (let time = Math.ceil(startMs / beat) * beat; time <= endMs && values.length < 20_000; time += beat) values.push(Math.round(time));
    }
    return values;
  }, [bpm, document, endMs, startMs]);
  const pct = (timeMs: number) => `${((timeMs - startMs) / spanMs) * 100}%`;
  const begin = (event: PointerEvent<HTMLElement>, target: TimelineTarget | null, side: Drag['side'], originalMs: number) => {
    event.preventDefault(); event.stopPropagation();
    if (target?.kind === 'line' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      const ids = document.lines.filter((item) => !item.backgroundOf).map((item) => item.id);
      const candidate = selectedLines.at(-1) ?? selectedLineId;
      const anchor = candidate && ids.includes(candidate) ? candidate : target.lineId;
      const first = ids.indexOf(anchor), last = ids.indexOf(target.lineId);
      setSelectedLines(event.shiftKey ? ids.slice(Math.min(first, last), Math.max(first, last) + 1) : selectedLines.includes(target.lineId) ? selectedLines.filter((id) => id !== target.lineId) : [...selectedLines, target.lineId]);
      return;
    }
    const lane = (event.currentTarget.closest('[data-track-lane]') ?? tracksRef.current!.querySelector('[data-track-lane]')) as HTMLElement;
    const next = { target, side, x: event.clientX, current: event.clientX, width: lane.getBoundingClientRect().width, originalMs };
    event.currentTarget.setPointerCapture(event.pointerId);
    frozenLayouts.current = currentLayouts;
    dragRef.current = next; setDrag(next);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const next = { ...dragRef.current, current: event.clientX };
    dragRef.current = next; setDrag(next);
    if (next.side === 'pan' && Math.abs(next.current - next.x) >= 4) onPan(next.originalMs - Math.round((next.current - next.x) / next.width * spanMs));
  };
  const finish = () => {
    const current = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!current) return;
    const delta = Math.round((current.current - current.x) / current.width * spanMs);
    if (current.side === 'pan') return;
    if (current.side === 'select') {
      const first = current.originalMs, last = current.originalMs + delta;
      setSelectedWords(words.filter((word) => word.beginMs! < Math.max(first, last) && word.endMs! > Math.min(first, last)).map((word) => word.id));
      return;
    }
    if (!current.target || Math.abs(current.current - current.x) < 3) {
      if (current.target?.kind === 'line') { setSelectedLines([current.target.lineId]); onSelectLine(current.target.lineId); }
      else if (current.target?.kind === 'word') setSelectedWords([current.target.wordId]);
      return;
    }
    const target = current.target;
    const proposed = current.originalMs + delta;
    const timeMs = snap ? snapTime(proposed, anchors.filter((value) => value !== current.originalMs), spanMs * 8 / current.width) : proposed;
    try {
      const changed = current.side === 'move'
        ? moveTimeline(document, target.kind === 'word' && selectedWords.includes(target.wordId) ? selectedWords.map((wordId) => ({ kind: 'word' as const, lineId: target.lineId, wordId })) : target.kind === 'line' && selectedLines.includes(target.lineId) ? selectedLines.map((lineId) => ({ kind: 'line' as const, lineId })) : [target], timeMs - current.originalMs)
        : resizeTimeline(document, target, current.side, timeMs);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '时间轴编辑失败'); }
  };
  const bar = (target: TimelineTarget, label: string, beginMs: number, endMs: number, active = false) => {
    const key = target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.rubyId;
    const layout = target.kind === 'line' ? lineLayout : target.kind === 'word' ? wordLayout : rubyLayout;
    const clippedBegin = Math.max(startMs, beginMs);
    const right = Math.min(endMs, propsEndMs);
    const narrow = (Math.min(endMs, propsEndMs) - clippedBegin) / spanMs * plotWidth < 16;
    return <div key={key} data-timeline-key={key}
      className={`${styles.trackBar} ${active ? styles.trackSelected : ''} ${narrow ? styles.narrowHit : ''} ${positionMs >= beginMs && positionMs < endMs ? styles.trackPlaying : ''}`} role="button" tabIndex={0} aria-label={label}
      style={{ left: pct(clippedBegin), width: `${(right - clippedBegin) / spanMs * 100}%`, top: `calc(${layout.lanes.get(key) ?? 0} * var(--timeline-lane-height) + var(--timeline-bar-inset))`, height: 'var(--timeline-bar-height)' }}
      onPointerDown={(event) => begin(event, target, 'move', beginMs)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (target.kind === 'line') onSelectLine(target.lineId); } }}>
      {narrow && <><span data-time-color className={styles.narrowColor} style={{ width: (right - clippedBegin) / spanMs * plotWidth }} /><span className={styles.narrowMarker} title="窄区间，请用时间轴缩放后调整边界" /></>}
      {!narrow && beginMs >= startMs && <span className={styles.trackHandle} aria-label={`${label}开始边界`} onPointerDown={(event) => begin(event, target, 'beginMs', beginMs)} onPointerMove={move} onPointerUp={finish} />}
      <span className={styles.trackBarText}>{label.replace(/^时间轴(?:行|词|注音) /, '')}</span>
      {!narrow && endMs <= propsEndMs && <span className={styles.trackHandle} aria-label={`${label}结束边界`} onPointerDown={(event) => begin(event, target, 'endMs', endMs)} onPointerMove={move} onPointerUp={finish} />}
    </div>;
  };
  const row = (name: string, content: React.ReactNode, selectable = false, laneCount = 1) => <div className={styles.trackRow} key={name}><strong>{name}</strong><div data-track-lane className={styles.trackLane} style={{ height: `calc(${Math.max(1, laneCount)} * var(--timeline-lane-height))` }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); begin(event, null, selectable && event.shiftKey ? 'select' : 'pan', selectable && event.shiftKey ? startMs + Math.round((event.clientX - rect.left) / rect.width * spanMs) : startMs); } }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
    {content}{drag && drag.side !== 'pan' && <span className={styles.dragGuide} style={{ left: pct(drag.originalMs + Math.round((drag.current - drag.x) / drag.width * spanMs)) }} />}</div></div>;
  const closeGap = (left: LyricWord, right: LyricWord) => {
    if (!line || left.endMs === null || right.beginMs === null) return;
    try {
      const middle = Math.round((left.endMs + right.beginMs) / 2);
      let changed = resizeTimeline(document, { kind: 'word', lineId: line.id, wordId: left.id }, 'endMs', middle);
      changed = resizeTimeline(changed, { kind: 'word', lineId: line.id, wordId: right.id }, 'beginMs', middle);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法闭合空隙'); }
  };
  return <div ref={tracksRef} className={styles.tracks} aria-label="可编辑时间轴">
    {visible.line && row('行', overview.filter(item => !editing || lineLayout.lanes.has(item.id)).map((item) => bar({ kind: 'line', lineId: item.id }, `时间轴行 L${ordinalById.get(item.id)}`, item.beginMs!, item.endMs!, selectedLines.includes(item.id) || item.id === line?.id)), false, lineLayout.laneCount)}
    {visible.line && backgrounds.length > 0 && row('背景', backgrounds.map((item) => <span key={item.id} className={`${styles.trackBar} ${styles.backgroundBar}`} aria-label={`L${ordinalById.get(item.backgroundOf!)} 背景歌词`} style={{ left: pct(item.beginMs!), width: `${(item.endMs! - item.beginMs!) / spanMs * 100}%` }}>L{ordinalById.get(item.backgroundOf!)} · 背景</span>))}
    {visible.word && line && (romanContent ? row(`音译`, romanContent.kind === 'timed' ? romanContent.units.filter((unit) => timed(unit.beginMs, unit.endMs) && unit.endMs! >= startMs && unit.beginMs! <= endMs).map((unit) => <span key={unit.id} className={`${styles.trackBar} ${styles.romanTrackBar}`} aria-label={`L${ordinalById.get(line.id)} 音译 ${romanTrack?.language ?? '未指定语言'} ${unit.text}`} style={{ left: pct(unit.beginMs!), width: `${(unit.endMs! - unit.beginMs!) / spanMs * 100}%` }}>{unit.text}</span>) : null)
      : row('词', words.filter(word => !editing || wordLayout.lanes.has(word.id)).map((word) => bar({ kind: 'word', lineId: line.id, wordId: word.id }, `时间轴词 ${word.text}`, word.beginMs!, word.endMs!, selectedWords.includes(word.id))), true, wordLayout.laneCount))}
    {visible.ruby && line && row('注音', rubies.filter(({ unit }) => !editing || rubyLayout.lanes.has(unit.id)).map(({ word, unit }) => bar({ kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: unit.id }, `时间轴注音 ${unit.reading}`, unit.beginMs!, unit.endMs!)), false, rubyLayout.laneCount)}
    {visible.gap && line && row('空隙', gaps.map(({ left, right, beginMs, endMs, overlap }) => <button data-role="secondary" key={`${left.id}:${right.id}`} className={`${styles.gapBar} ${overlap ? styles.overlap : ''}`}
      style={{ left: pct(beginMs), width: `${Math.max(1, (endMs - beginMs) / spanMs * 100)}%` }} title={overlap ? '消除重叠' : '闭合空隙'} onClick={() => closeGap(left, right)}>{overlap ? '重叠' : '空隙'}</button>))}
  </div>;
}
