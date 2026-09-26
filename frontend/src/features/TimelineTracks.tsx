import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument, LyricLine, LyricWord } from '../domain/lyric-document';
import { moveTimeline, resizeTimeline, snapTime, type TimelineTarget } from '../domain/timeline-editing';
import styles from './media.module.css';

type Props = { document: LyricDocument; selectedLineId: string | null; startUs: number; endUs: number; positionUs: number; bpm: number; snap: boolean;
  apply: (command: LyricCommand) => void; onSelectLine: (lineId: string) => void; onError: (message: string) => void };
type Drag = { target: TimelineTarget | null; side: 'move' | 'beginUs' | 'endUs' | 'select'; x: number; current: number; width: number; originalUs: number };
const timed = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

export function TimelineTracks({ document, selectedLineId, startUs, endUs, positionUs, bpm, snap, apply, onSelectLine, onError }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const spanUs = Math.max(1, endUs - startUs);
  const line = document.lines.find((item) => item.id === selectedLineId && !item.backgroundOf) ?? document.lines.find((item) => !item.backgroundOf);
  const allLines = document.lines.filter((item) => !item.backgroundOf && timed(item.beginUs, item.endUs) && item.endUs! >= startUs && item.beginUs! <= endUs);
  const stride = Math.max(1, Math.ceil(allLines.length / 120));
  const overview = allLines.filter((item, index) => index % stride === 0 || item.id === line?.id);
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
    const lane = event.currentTarget.closest('[data-track-lane]') as HTMLElement;
    const next = { target, side, x: event.clientX, current: event.clientX, width: lane.getBoundingClientRect().width, originalUs };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = next; setDrag(next);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const next = { ...dragRef.current, current: event.clientX };
    dragRef.current = next; setDrag(next);
  };
  const finish = () => {
    const current = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!current) return;
    const delta = Math.round((current.current - current.x) / current.width * spanUs);
    if (current.side === 'select') {
      const first = current.originalUs, last = current.originalUs + delta;
      setSelectedWords(words.filter((word) => word.beginUs! < Math.max(first, last) && word.endUs! > Math.min(first, last)).map((word) => word.id));
      return;
    }
    if (!current.target || Math.abs(current.current - current.x) < 3) {
      if (current.target?.kind === 'line') onSelectLine(current.target.lineId);
      else if (current.target?.kind === 'word') setSelectedWords([current.target.wordId]);
      return;
    }
    const target = current.target;
    const proposed = current.originalUs + delta;
    const timeUs = snap ? snapTime(proposed, anchors.filter((value) => value !== current.originalUs), spanUs * 8 / current.width) : proposed;
    try {
      const changed = current.side === 'move'
        ? moveTimeline(document, target.kind === 'word' && selectedWords.includes(target.wordId) ? selectedWords.map((wordId) => ({ kind: 'word' as const, lineId: target.lineId, wordId })) : [target], timeUs - current.originalUs)
        : resizeTimeline(document, target, current.side, timeUs);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '时间轴编辑失败'); }
  };
  const bar = (target: TimelineTarget, label: string, beginUs: number, endUs: number, active = false) => <div key={`${target.kind}:${target.lineId}:${target.kind === 'line' ? '' : target.wordId}:${target.kind === 'ruby' ? target.rubyId : ''}`}
    className={`${styles.trackBar} ${active ? styles.trackSelected : ''} ${positionUs >= beginUs && positionUs < endUs ? styles.trackPlaying : ''}`} role="button" tabIndex={0} aria-label={label}
    style={{ left: pct(beginUs), width: `${Math.max(0.8, (endUs - beginUs) / spanUs * 100)}%` }}
    onPointerDown={(event) => begin(event, target, 'move', beginUs)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
    onKeyDown={(event) => { if (event.key === 'Enter' && target.kind === 'line') onSelectLine(target.lineId); }}>
    <span className={styles.trackHandle} aria-label={`${label}开始边界`} onPointerDown={(event) => begin(event, target, 'beginUs', beginUs)} onPointerMove={move} onPointerUp={finish} />
    <span className={styles.trackBarText}>{label.replace(/^时间轴(?:行|词|Ruby) /, '')}</span>
    <span className={styles.trackHandle} aria-label={`${label}结束边界`} onPointerDown={(event) => begin(event, target, 'endUs', endUs)} onPointerMove={move} onPointerUp={finish} />
  </div>;
  const row = (name: string, content: React.ReactNode, selectable = false) => <div className={styles.trackRow} key={name}><strong>{name}</strong><div data-track-lane className={styles.trackLane}
    onPointerDown={selectable ? (event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); begin(event, null, 'select', startUs + Math.round((event.clientX - rect.left) / rect.width * spanUs)); } } : undefined}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
    {content}{drag && <span className={styles.dragGuide} style={{ left: pct(drag.originalUs + Math.round((drag.current - drag.x) / drag.width * spanUs)) }} />}</div></div>;
  const closeGap = (left: LyricWord, right: LyricWord) => {
    if (!line || left.endUs === null || right.beginUs === null) return;
    try {
      const middle = Math.round((left.endUs + right.beginUs) / 2);
      let changed = resizeTimeline(document, { kind: 'word', lineId: line.id, wordId: left.id }, 'endUs', middle);
      changed = resizeTimeline(changed, { kind: 'word', lineId: line.id, wordId: right.id }, 'beginUs', middle);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法闭合空隙'); }
  };
  return <div className={styles.tracks} aria-label="可编辑时间轴">
    {row('行', overview.map((item) => bar({ kind: 'line', lineId: item.id }, `时间轴行 ${item.id}`, item.beginUs!, item.endUs!, item.id === line?.id)))}
    {line && row('词', words.map((word) => bar({ kind: 'word', lineId: line.id, wordId: word.id }, `时间轴词 ${word.text}`, word.beginUs!, word.endUs!, selectedWords.includes(word.id))), true)}
    {line && row('Ruby', rubies.map(({ word, unit }) => bar({ kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: unit.id }, `时间轴Ruby ${unit.reading}`, unit.beginUs!, unit.endUs!)))}
    {line && row('空隙', gaps.map(({ left, right, beginUs, endUs, overlap }) => <button key={`${left.id}:${right.id}`} className={`${styles.gapBar} ${overlap ? styles.overlap : ''}`}
      style={{ left: pct(beginUs), width: `${Math.max(1, (endUs - beginUs) / spanUs * 100)}%` }} title={overlap ? '消除重叠' : '闭合空隙'} onClick={() => closeGap(left, right)}>{overlap ? '重叠' : '空隙'}</button>))}
  </div>;
}
