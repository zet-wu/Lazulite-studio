import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument, LyricWord } from '../domain/lyric-document';
import { moveTimeline, resizeTimeline, snapTime, type TimelineTarget } from '../domain/timeline-editing';
import { packIntervals } from '../domain/pack-intervals';
import styles from './media.module.css';

type Props = { document: LyricDocument; selectedLineId: string | null; selectedRomanization: { trackId: string; contentId: string } | null; startUs: number; endUs: number; positionUs: number; bpm: number; snap: boolean;
  visible: { line: boolean; word: boolean; ruby: boolean; gap: boolean };
  apply: (command: LyricCommand) => void; onSelectLine: (lineId: string) => void; onPan: (startUs: number) => void; onError: (message: string) => void; onZoomRange: (beginUs: number, endUs: number) => void };
type Drag = { target: TimelineTarget | null; side: 'move' | 'beginUs' | 'endUs' | 'select' | 'pan'; x: number; current: number; width: number; originalUs: number };
const timed = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

export function TimelineTracks({ document, selectedLineId, selectedRomanization, startUs, endUs, positionUs, bpm, snap, visible, apply, onSelectLine, onPan, onError, onZoomRange }: Props) {
  const tracksRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(640);
  const [boundary, setBoundary] = useState<{ target: TimelineTarget; label: string; beginUs: number; endUs: number } | null>(null);
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
  const propsEndUs = endUs;
  const spanUs = Math.max(1, endUs - startUs);
  const mainLines = document.lines.filter((item) => !item.backgroundOf);
  const ordinalById = new Map(mainLines.map((item, index) => [item.id, index + 1]));
  const line = document.lines.find((item) => item.id === selectedLineId && !item.backgroundOf) ?? document.lines.find((item) => !item.backgroundOf);
  const romanTrack = document.romanizationTracks.find((track) => track.id === selectedRomanization?.trackId);
  const romanContent = romanTrack?.contents.find((content) => content.id === selectedRomanization?.contentId && content.lineId === line?.id);
  const allTimedLines = mainLines.filter(item => timed(item.beginUs, item.endUs));
  const allLines = allTimedLines.filter((item) => timed(item.beginUs, item.endUs) && item.endUs! >= startUs && item.beginUs! <= endUs);
  const backgrounds = document.lines.filter((item) => item.backgroundOf && timed(item.beginUs, item.endUs) && item.endUs! >= startUs && item.beginUs! <= endUs);
  const overview = allLines;
  const allWords = line?.words.filter(word => timed(word.beginUs, word.endUs)) ?? [];
  const allRubies = allWords.flatMap(word => word.rubyUnits.filter(unit => timed(unit.beginUs, unit.endUs)).map(unit => ({ word, unit })));
  const lineLayout = useMemo(() => packIntervals(document.lines.filter(item => !item.backgroundOf && timed(item.beginUs, item.endUs)).map(item => ({ key: item.id, beginUs: item.beginUs!, endUs: item.endUs! }))), [document]);
  const wordLayout = useMemo(() => packIntervals(allWords.map(item => ({ key: item.id, beginUs: item.beginUs!, endUs: item.endUs! }))), [line]);
  const rubyLayout = useMemo(() => packIntervals(allRubies.map(({ unit }) => ({ key: unit.id, beginUs: unit.beginUs!, endUs: unit.endUs! }))), [line]);
  const words = line?.words.filter((word) => timed(word.beginUs, word.endUs) && word.endUs! >= startUs && word.beginUs! <= endUs) ?? [];
  const rubies = words.flatMap((word) => word.rubyUnits.filter((unit) => timed(unit.beginUs, unit.endUs) && unit.endUs! >= startUs && unit.beginUs! <= endUs).map((unit) => ({ word, unit })));
  const gaps = line?.words.flatMap((word, index) => {
    const right = line.words[index + 1];
    return right && word.endUs !== null && right.beginUs !== null && word.endUs !== right.beginUs ? [{ left: word, right, beginUs: Math.min(word.endUs, right.beginUs), endUs: Math.max(word.endUs, right.beginUs), overlap: word.endUs > right.beginUs }] : [];
  }) ?? [];
  const anchors = useMemo(() => {
    const values = document.lines.flatMap((item) => [item.beginUs, item.endUs, ...item.words.flatMap((word) => [word.beginUs, word.endUs, ...word.rubyUnits.flatMap((unit) => [unit.beginUs, unit.endUs])])]).filter((value): value is number => value !== null && value >= startUs && value <= endUs);
    if (bpm > 0) {
      const beat = 60_000_000 / bpm;
      for (let time = Math.ceil(startUs / beat) * beat; time <= endUs && values.length < 20_000; time += beat) values.push(Math.round(time));
    }
    return values;
  }, [bpm, document, endUs, startUs]);
  const pct = (timeUs: number) => `${((timeUs - startUs) / spanUs) * 100}%`;
  const begin = (event: PointerEvent<HTMLElement>, target: TimelineTarget | null, side: Drag['side'], originalUs: number) => {
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
    const next = { target, side, x: event.clientX, current: event.clientX, width: lane.getBoundingClientRect().width, originalUs };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = next; setDrag(next);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const next = { ...dragRef.current, current: event.clientX };
    dragRef.current = next; setDrag(next);
    if (next.side === 'pan' && Math.abs(next.current - next.x) >= 4) onPan(next.originalUs - Math.round((next.current - next.x) / next.width * spanUs));
  };
  const finish = () => {
    const current = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!current) return;
    const delta = Math.round((current.current - current.x) / current.width * spanUs);
    if (current.side === 'pan') return;
    if (current.side === 'select') {
      const first = current.originalUs, last = current.originalUs + delta;
      setSelectedWords(words.filter((word) => word.beginUs! < Math.max(first, last) && word.endUs! > Math.min(first, last)).map((word) => word.id));
      return;
    }
    if (!current.target || Math.abs(current.current - current.x) < 3) {
      if (current.target?.kind === 'line') { setSelectedLines([current.target.lineId]); onSelectLine(current.target.lineId); }
      else if (current.target?.kind === 'word') setSelectedWords([current.target.wordId]);
      return;
    }
    const target = current.target;
    const proposed = current.originalUs + delta;
    const timeUs = snap ? snapTime(proposed, anchors.filter((value) => value !== current.originalUs), spanUs * 8 / current.width) : proposed;
    try {
      const changed = current.side === 'move'
        ? moveTimeline(document, target.kind === 'word' && selectedWords.includes(target.wordId) ? selectedWords.map((wordId) => ({ kind: 'word' as const, lineId: target.lineId, wordId })) : target.kind === 'line' && selectedLines.includes(target.lineId) ? selectedLines.map((lineId) => ({ kind: 'line' as const, lineId })) : [target], timeUs - current.originalUs)
        : resizeTimeline(document, target, current.side, timeUs);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '时间轴编辑失败'); }
  };
  const bar = (target: TimelineTarget, label: string, beginUs: number, endUs: number, active = false) => {
    const key = target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.rubyId;
    const layout = target.kind === 'line' ? lineLayout : target.kind === 'word' ? wordLayout : rubyLayout;
    const clippedBegin = Math.max(startUs, beginUs);
    const right = Math.min(endUs, propsEndUs);
    const narrow = (Math.min(endUs, propsEndUs) - clippedBegin) / spanUs * plotWidth < 16;
    const choose = () => setBoundary({ target, label, beginUs, endUs });
    return <div key={key} data-timeline-key={key}
      className={`${styles.trackBar} ${active ? styles.trackSelected : ''} ${narrow ? styles.narrowHit : ''} ${positionUs >= beginUs && positionUs < endUs ? styles.trackPlaying : ''}`} role="button" tabIndex={0} aria-label={label}
      style={{ left: pct(clippedBegin), width: `${(right - clippedBegin) / spanUs * 100}%`, top: 1 + layout.lanes.get(key)! * 22, height: 20 }}
      onFocus={choose} onPointerDown={(event) => { choose(); begin(event, target, 'move', beginUs); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); choose(); if (target.kind === 'line') onSelectLine(target.lineId); } }}>
      {narrow && <><span data-time-color className={styles.narrowColor} style={{ width: (right - clippedBegin) / spanUs * plotWidth }} /><span className={styles.narrowMarker} title="窄区间：选中后放大或使用分离边界控件" /></>}
      {!narrow && beginUs >= startUs && <span className={styles.trackHandle} aria-label={`${label}开始边界`} onPointerDown={(event) => begin(event, target, 'beginUs', beginUs)} onPointerMove={move} onPointerUp={finish} />}
      <span className={styles.trackBarText}>{label.replace(/^时间轴(?:行|词|Ruby) /, '')}</span>
      {!narrow && endUs <= propsEndUs && <span className={styles.trackHandle} aria-label={`${label}结束边界`} onPointerDown={(event) => begin(event, target, 'endUs', endUs)} onPointerMove={move} onPointerUp={finish} />}
    </div>;
  };
  const row = (name: string, content: React.ReactNode, selectable = false, laneCount = 1) => <div className={styles.trackRow} key={name}><strong>{name}</strong><div data-track-lane className={styles.trackLane} style={{ height: Math.max(1, laneCount) * 22 }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); begin(event, null, selectable && event.shiftKey ? 'select' : 'pan', selectable && event.shiftKey ? startUs + Math.round((event.clientX - rect.left) / rect.width * spanUs) : startUs); } }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
    {content}{drag && drag.side !== 'pan' && <span className={styles.dragGuide} style={{ left: pct(drag.originalUs + Math.round((drag.current - drag.x) / drag.width * spanUs)) }} />}</div></div>;
  const selectedTime = (() => {
    if (!boundary) return null;
    const target = boundary.target;
    const selectedLine = document.lines.find(item => item.id === target.lineId);
    const word = target.kind === 'line' ? null : selectedLine?.words.find(item => item.id === target.wordId);
    const item = target.kind === 'line' ? selectedLine : target.kind === 'word' ? word : word?.rubyUnits.find(item => item.id === target.rubyId);
    return item && timed(item.beginUs, item.endUs) ? { ...boundary, beginUs: item.beginUs!, endUs: item.endUs! } : null;
  })();
  const closeGap = (left: LyricWord, right: LyricWord) => {
    if (!line || left.endUs === null || right.beginUs === null) return;
    try {
      const middle = Math.round((left.endUs + right.beginUs) / 2);
      let changed = resizeTimeline(document, { kind: 'word', lineId: line.id, wordId: left.id }, 'endUs', middle);
      changed = resizeTimeline(changed, { kind: 'word', lineId: line.id, wordId: right.id }, 'beginUs', middle);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法闭合空隙'); }
  };
  return <><div ref={tracksRef} className={styles.tracks} aria-label="可编辑时间轴">
    {visible.line && row('行', overview.map((item) => bar({ kind: 'line', lineId: item.id }, `时间轴行 L${ordinalById.get(item.id)}`, item.beginUs!, item.endUs!, selectedLines.includes(item.id) || item.id === line?.id)), false, lineLayout.laneCount)}
    {visible.line && backgrounds.length > 0 && row('背景', backgrounds.map((item) => <span key={item.id} className={`${styles.trackBar} ${styles.backgroundBar}`} aria-label={`L${ordinalById.get(item.backgroundOf!)} 背景歌词`} style={{ left: pct(item.beginUs!), width: `${(item.endUs! - item.beginUs!) / spanUs * 100}%` }}>L{ordinalById.get(item.backgroundOf!)} · 背景</span>))}
    {visible.word && line && (romanContent ? row(`音译`, romanContent.kind === 'timed' ? romanContent.units.filter((unit) => timed(unit.beginUs, unit.endUs) && unit.endUs! >= startUs && unit.beginUs! <= endUs).map((unit) => <span key={unit.id} className={`${styles.trackBar} ${styles.romanTrackBar}`} aria-label={`L${ordinalById.get(line.id)} 音译 ${romanTrack?.language ?? '未指定语言'} ${unit.text}`} style={{ left: pct(unit.beginUs!), width: `${(unit.endUs! - unit.beginUs!) / spanUs * 100}%` }}>{unit.text}</span>) : null)
      : row('词', words.map((word) => bar({ kind: 'word', lineId: line.id, wordId: word.id }, `时间轴词 ${word.text}`, word.beginUs!, word.endUs!, selectedWords.includes(word.id))), true, wordLayout.laneCount))}
    {visible.ruby && line && row('Ruby', rubies.map(({ word, unit }) => bar({ kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: unit.id }, `时间轴Ruby ${unit.reading}`, unit.beginUs!, unit.endUs!)), false, rubyLayout.laneCount)}
    {visible.gap && line && row('空隙', gaps.map(({ left, right, beginUs, endUs, overlap }) => <button key={`${left.id}:${right.id}`} className={`${styles.gapBar} ${overlap ? styles.overlap : ''}`}
      style={{ left: pct(beginUs), width: `${Math.max(1, (endUs - beginUs) / spanUs * 100)}%` }} title={overlap ? '消除重叠' : '闭合空隙'} onClick={() => closeGap(left, right)}>{overlap ? '重叠' : '空隙'}</button>))}
  </div>{selectedTime && <div className={styles.timelineTools} aria-label="选中区间边界">
    <span>{selectedTime.label}</span>
    {(['beginUs', 'endUs'] as const).map(side => <button key={side} aria-label={`调整${side === 'beginUs' ? '开始' : '结束'}边界`}
      onPointerDown={event => begin(event, selectedTime.target, side, selectedTime[side])} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
      {side === 'beginUs' ? '开始' : '结束'} ↔
    </button>)}
    <button onClick={() => onZoomRange(selectedTime.beginUs, selectedTime.endUs)}>放大选中区间</button>
  </div>}</>;
}
