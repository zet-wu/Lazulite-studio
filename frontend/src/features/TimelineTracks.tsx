import { KaraokeContext } from './KaraokeContext';
import { createProjectEditorState, executeProjectCommand } from '../domain/project-document';
import { KaraokeTrack } from './KaraokeTrack';
import { useProjectEditing } from './editor/ProjectEditingContext';
import { projectTimeline } from '../domain/timeline-projection';
import { createPortal } from 'react-dom';
import { EditorContextMenu } from './editor/EditorContextMenu';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEditorSelection } from './editor/SelectionContext';
import { documentTargets, targetId, targetSelection, selectionKind, selectionTargets, targetInterval } from './editor/selection-targets';
import { selectIds } from './editor/editing-actions';
import { TimelineIndicators, TimelineIndicatorContext } from './TimelineIndicators';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument, LyricWord } from '../domain/lyric-document';
import { moveTimeline, resizeTimeline, snapTimelineTime, timelineDelta, type TimelineTarget } from '../domain/timeline-editing';
import { packIntervals } from '../domain/pack-intervals';
import styles from './media.module.css';

type Props = { locked?: boolean; document: LyricDocument; selectedLineId: string | null; startMs: number; endMs: number; positionMs: number; bpm: number; snap: boolean;
  visible: { line: boolean; word: boolean; ruby: boolean; gap: boolean; romanization: boolean };
  externalAnchors?: number[]; durationMs?: number | null;
  apply: (command: LyricCommand) => void; onPan: (startMs: number) => void; onError: (message: string) => void };
type Drag = { source: LyricDocument; target: TimelineTarget | null; side: 'move' | 'beginMs' | 'endMs' | 'select' | 'pan'; x: number; current: number; width: number; originalMs: number; candidate: { timeMs: number; document: LyricDocument; error: string } };
const timed = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end >= begin;

export function TimelineTracks({ locked, document, selectedLineId, startMs, endMs, positionMs, bpm, snap, visible, externalAnchors = [], durationMs = null, apply, onPan, onError }: Props) {
  const editing = useProjectEditing();
  const projectContext = useContext(KaraokeContext);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(640);
  useEffect(() => {
    const lane = tracksRef.current!.querySelector('[data-track-lane]');
    if (!lane) return;
    const observer = new ResizeObserver(() => setPlotWidth(lane.getBoundingClientRect().width));
    observer.observe(lane); return () => observer.disconnect();
  }, [visible.line, visible.word, visible.ruby]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { selection, setSelection, expanded, commands } = useEditorSelection()!;
  const expandedLines = document.lines.filter(line => expanded.includes(line.id) && (visible.word || visible.ruby && line.words.some(word => word.rubyUnits.length) || visible.romanization && [...document.romanizationTracks,...document.translationTracks].some(track => track.contents.some(content => content.lineId === line.id))));
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: expandedLines.length, getScrollElement: () => scrollRef.current, estimateSize: () => 80, overscan: 3, getItemKey: index => expandedLines[index].id });
  const [menu, setMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  const closeMenu = () => { const target = menu?.target; setMenu(null); if (target?.isConnected) target.focus({ preventScroll: true }); };
  const allTargets = useMemo(() => documentTargets(document), [document]);
  const choose = (target: TimelineTarget, shift = false, toggle = false) => {
    const id = targetId(target), previous = selection?.kind === selectionKind(target) && (target.kind!=='romanization'||(selection.kind==='romanization-unit'&&selection.attachment===target.attachment)) ? selection : null;
    const order = allTargets.filter(item => item.kind === target.kind && (target.kind!=='romanization'||item.kind==='romanization'&&item.attachment===target.attachment) && (!shift || target.kind !== 'romanization' || item.kind === 'romanization' && item.trackId === target.trackId)).map(targetId);
    const ids = !shift && !toggle && previous?.ids.includes(id) ? previous.ids : selectIds(order, previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection(targetSelection(target, ids, shift || toggle || previous?.ids.includes(id) ? previous?.anchorId ?? id : id));
  };
  const dragRef = useRef<Drag | null>(null);
  const { publish } = useContext(TimelineIndicatorContext);
  const capture = useRef<{ element: HTMLElement; id: number } | null>(null);
  const cancel = useCallback(() => {
    dragRef.current = null; setDrag(null); publish(null);
    const held = capture.current; capture.current = null;
    if (held?.element.hasPointerCapture(held.id)) held.element.releasePointerCapture(held.id);
  }, [publish]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', escape); return () => { window.removeEventListener('keydown', escape); cancel(); };
  }, [cancel]);
  useEffect(() => { cancel(); }, [document, durationMs, visible.line, visible.word, visible.ruby, visible.romanization, cancel]);
  useEffect(() => { if (dragRef.current?.side !== 'pan') cancel(); }, [startMs, endMs, cancel]);
  const projection = useMemo(() => projectTimeline(document, durationMs), [document, durationMs]);
  const candidateDocument = drag?.candidate.document ?? document;
  const displayed = projectTimeline(candidateDocument, durationMs);
  const propsEndMs = endMs;
  const spanMs = Math.max(1, endMs - startMs);
  const mainLines = displayed.lines;
  const ordinalById = new Map(mainLines.filter(item => !item.backgroundOf).map((item, index) => [item.id, index + 1]));
  const line = displayed.lines.find((item) => item.id === selectedLineId) ?? displayed.lines.find((item) => !item.backgroundOf);
  const intersects = (begin: number | null, end: number | null) => timed(begin, end) && end! >= startMs && begin! <= endMs;
  const overview = mainLines.filter(item => intersects(item.beginMs, item.endMs));
  const currentLayout = useMemo(() => packIntervals(projection.lines.filter(item => intersects(item.beginMs, item.endMs)).map(item => ({ key: item.id, beginMs: item.beginMs!, endMs: item.endMs! }))), [projection, startMs, endMs]);
  const frozenLayout = useRef(currentLayout);
  const draggingTime = drag && !['pan', 'select'].includes(drag.side);
  if (!draggingTime) frozenLayout.current = currentLayout;
  const lineLayout = draggingTime ? frozenLayout.current : currentLayout;
  const gaps = line?.words.flatMap((word, index) => {
    const right = line.words[index + 1];
    return right && word.endMs !== null && right.beginMs !== null && word.endMs !== right.beginMs ? [{ left: word, right, beginMs: Math.min(word.endMs, right.beginMs), endMs: Math.max(word.endMs, right.beginMs), overlap: word.endMs > right.beginMs }] : [];
  }) ?? [];
  const pct = (timeMs: number) => `${((timeMs - startMs) / spanMs) * 100}%`;
  const begin = (event: PointerEvent<HTMLElement>, target: TimelineTarget | null, side: Drag['side'], originalMs: number) => {
    if (event.button !== 0 || locked && target !== null) return;
    event.preventDefault(); event.stopPropagation();
    if (target) {
      (event.currentTarget.closest('[data-timeline-key]') as HTMLElement)?.focus({ preventScroll: true });
      choose(target, event.shiftKey, event.ctrlKey || event.metaKey);
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    }
    const lane = (event.currentTarget.closest('[data-track-lane]') ?? tracksRef.current!.querySelector('[data-track-lane]')) as HTMLElement;
    const next: Drag = { source: document, target, side, x: event.clientX, current: event.clientX, width: lane.getBoundingClientRect().width, originalMs, candidate: { timeMs: originalMs, document, error: '' } };
    event.currentTarget.setPointerCapture(event.pointerId);
    capture.current = { element: event.currentTarget, id: event.pointerId };
    if (side !== 'pan') publish({ timeMs: originalMs, valid: true });
    frozenLayout.current = currentLayout;
    dragRef.current = next; setDrag(next);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const delta = timelineDelta(event.clientX - current.x, current.width, spanMs);
    const proposed = current.originalMs + delta;
    const moving = current.target ? (selectionTargets(document, selection).some(item => targetId(item) === targetId(current.target!)) ? selectionTargets(document, selection) : [current.target]) : [];
    const excluded = (item: TimelineTarget) => moving.some(target => targetId(target) === targetId(item) || current.side === 'move' && (target.kind === 'line' && item.lineId === target.lineId || target.kind === 'word' && item.kind === 'ruby' && item.wordId === target.wordId));
    // Parent envelopes and linked ends can change indirectly. Compare endpoint
    // identities against the unsnapped edit, preserving unrelated equal times.
    let unsnapped = document;
    if (current.target) try {
      unsnapped = current.side === 'move' ? moveTimeline(document, moving, delta, editing)
        : resizeTimeline(document, current.target, current.side as 'beginMs' | 'endMs', proposed, editing);
    } catch { /* Invalid candidates still receive the normal validation below. */ }
    const candidateAnchors = [...externalAnchors, ...allTargets.filter(item => !excluded(item)).flatMap(item => {
      const before = targetInterval(document, item), after = targetInterval(unsnapped, item);
      return before && after ? (['beginMs', 'endMs'] as const).flatMap(side => before[side] !== null && before[side] === after[side] ? [before[side]!] : []) : [];
    })];
    if (bpm > 0) for (let time = Math.ceil(startMs / (60000 / bpm)) * (60000 / bpm); time <= endMs && candidateAnchors.length < 20000; time += 60000 / bpm) candidateAnchors.push(Math.round(time));
    const timeMs = current.side === 'select' || current.side === 'pan' ? proposed
      : snapTimelineTime(proposed, candidateAnchors, spanMs, current.width, snap);
    const candidate = { timeMs, document, error: '' };
    if (current.target && Math.abs(event.clientX - current.x) >= 3) {
      const target = current.target;
      try {
        if (durationMs !== null && timeMs > durationMs) throw new Error('时间超出歌曲范围');
        candidate.document = current.side === 'move'
          ? moveTimeline(document, moving, timeMs - current.originalMs, editing)
          : resizeTimeline(document, target, current.side as 'beginMs' | 'endMs', timeMs, editing);
        if (projectContext && current.side === 'move' && moving.every(item => item.kind === 'line')) {
          executeProjectCommand(createProjectEditorState(projectContext.project), { type: 'lyrics', command: { type: 'shift-lines', lineIds: moving.map(item => item.lineId), deltaMs: timeMs - current.originalMs } });
        }
      } catch (cause) { candidate.error = cause instanceof Error ? cause.message : '时间轴编辑失败'; }
      onError(candidate.error);
    } else if (current.target) candidate.timeMs = current.originalMs;
    const next = { ...current, current: event.clientX, candidate };
    dragRef.current = next; setDrag(next);
    if (next.side === 'pan') { if (Math.abs(next.current - next.x) >= 4) onPan(next.originalMs - delta); }
    else publish({ timeMs: candidate.timeMs, valid: !candidate.error });
  };
  const finish = () => {
    const current = dragRef.current;
    cancel();
    if (!current || current.source !== document || current.side === 'pan') return;
    if (current.side === 'select') {
      const first = current.originalMs, last = current.candidate.timeMs;
      const picked = boxTargets.current.filter(target => { const item = targetInterval(projection, target); return item && item.beginMs !== null && item.endMs !== null && item.beginMs < Math.max(first, last) && item.endMs > Math.min(first, last); });
      if (picked.length) setSelection(targetSelection(picked.at(-1)!, picked.map(targetId), targetId(picked[0])));
      return;
    }
    if (!current.target || Math.abs(current.current - current.x) < 3) {
      if (current.target) choose(current.target);
      return;
    }
    if (current.candidate.error) { onError(current.candidate.error); return; }
    const moving = selectionTargets(document, selection).some(item => targetId(item) === targetId(current.target!)) ? selectionTargets(document, selection) : [current.target];
    apply(current.side === 'move' && moving.every(target => target.kind === 'line')
      ? { type: 'shift-lines', lineIds: moving.map(target => target.lineId), deltaMs: current.candidate.timeMs - current.originalMs }
      : { type: 'replace-document', document: current.candidate.document }); onError('');
  };
  const boxTargets = useRef<TimelineTarget[]>([]);
  const bar = (target: TimelineTarget, label: string, beginMs: number, endMs: number, active = false, laneLayoutOverride?: ReturnType<typeof packIntervals>) => {
    const key = target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;
    const layout = laneLayoutOverride ?? lineLayout;
    const real = targetInterval(candidateDocument, target);
    const ghostBegin = real?.beginMs === null, ghostEnd = real?.endMs === null;
    const description = ghostBegin || ghostEnd ? `${ghostBegin ? '开始' : '结束'}未定，临时端点 ${ghostBegin ? beginMs : endMs} 毫秒，拖动该边界设置真实时间` : undefined;
    active = selection?.kind === selectionKind(target) && selection.ids.includes(key) || false;
    const clippedBegin = Math.max(startMs, beginMs);
    const right = Math.min(endMs, propsEndMs);
    const narrow = (Math.min(endMs, propsEndMs) - clippedBegin) / spanMs * plotWidth < 16;
    return <div key={key} data-timeline-key={key} data-line-id={target.lineId} data-word-id={target.kind==='word'||target.kind==='ruby'?target.wordId:undefined} data-ruby-id={target.kind==='ruby'?target.rubyId:undefined} data-romanization-content-id={target.kind==='romanization'&&!target.attachment?target.contentId:undefined} data-romanization-unit-id={target.kind==='romanization'&&!target.attachment?target.unitId:undefined} data-translation-id={target.kind==='romanization'&&target.attachment?target.contentId:undefined} data-translation-unit-id={target.kind==='romanization'&&target.attachment?target.unitId:undefined}
      className={`${styles.trackBar} ${target.kind === 'line' && document.lines.find(line => line.id === target.lineId)?.backgroundOf ? styles.backgroundBar : ''} ${active ? styles.trackSelected : ''} ${narrow ? styles.narrowHit : ''} ${real?.beginMs != null && real?.endMs != null && positionMs >= real.beginMs && positionMs < real.endMs ? styles.trackPlaying : ''}`} role="button" aria-disabled={locked} tabIndex={0} aria-label={label} title={description} aria-description={description} data-temporary-begin={ghostBegin || undefined} data-temporary-end={ghostEnd || undefined}
      style={{ transform: narrow && beginMs === endMs && beginMs === propsEndMs ? 'translateX(-100%)' : undefined, left: pct(clippedBegin), width: `${(right - clippedBegin) / spanMs * 100}%`, top: `calc(${layout.lanes.get(key) ?? 0} * var(--timeline-lane-height) + var(--timeline-bar-inset))`, height: 'var(--timeline-bar-height)' }}
      onPointerDown={(event) => begin(event, target, 'move', beginMs)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onFocus={() => { if (!dragRef.current) choose(target); }}
      onContextMenu={event => { event.preventDefault(); if(locked)return; event.stopPropagation(); if(!commands.current?.openContext(event.currentTarget,event.clientX,event.clientY)){choose(target); setMenu({ x: event.clientX, y: event.clientY, target: event.currentTarget });} }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(target, event.shiftKey, event.ctrlKey || event.metaKey); }
        if (!locked && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); if(!commands.current?.openContext(event.currentTarget,box.left,box.bottom)){choose(target);setMenu({ x: box.left, y: box.bottom, target: event.currentTarget });} }
        if (event.key === 'Delete' && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !dragRef.current) { event.preventDefault(); event.stopPropagation(); commands.current?.remove(); }
      }}>
      {narrow && <><span data-time-color className={styles.narrowColor} style={{ width: (right - clippedBegin) / spanMs * plotWidth }} /><span className={styles.narrowMarker} title="窄区间，请用时间轴缩放后调整边界" /></>}
      {(!narrow || ghostBegin) && beginMs >= startMs && <span className={`${styles.trackHandle} ${ghostBegin ? styles.temporaryHandle : ''}`} title={ghostBegin ? description : undefined} aria-label={`${label}开始边界`} onPointerDown={(event) => begin(event, target, 'beginMs', beginMs)} onPointerMove={move} onPointerUp={finish} />}
      <span className={styles.trackBarText}>{label.replace(/^时间轴(?:行|词|注音) /, '')}</span>
      {(!narrow || ghostEnd) && endMs <= propsEndMs && <span className={`${styles.trackHandle} ${ghostEnd ? styles.temporaryHandle : ''}`} title={ghostEnd ? description : undefined} aria-label={`${label}结束边界`} onPointerDown={(event) => begin(event, target, 'endMs', endMs)} onPointerMove={move} onPointerUp={finish} />}
    </div>;
  };
  const row = (name: string, content: React.ReactNode, selectable: TimelineTarget[] = [], laneCount = 1, caption = name) => <div className={styles.trackRow} key={name}><strong title={name}>{caption}</strong><div data-track-lane className={styles.trackLane} style={{ height: `calc(${Math.max(1, laneCount)} * var(--timeline-lane-height))` }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); boxTargets.current = selectable; begin(event, null, selectable.length > 0 && event.shiftKey ? 'select' : 'pan', selectable.length > 0 && event.shiftKey ? startMs + Math.round((event.clientX - rect.left) / rect.width * spanMs) : startMs); } }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {content}<TimelineIndicators /></div></div>;
  const closeGap = (left: LyricWord, right: LyricWord) => {
    if (!line || left.endMs === null || right.beginMs === null) return;
    try {
      const middle = Math.round((left.endMs + right.beginMs) / 2);
      let changed = resizeTimeline(document, { kind: 'word', lineId: line.id, wordId: left.id }, 'endMs', middle, editing);
      changed = resizeTimeline(changed, { kind: 'word', lineId: line.id, wordId: right.id }, 'beginMs', middle, editing);
      apply({ type: 'replace-document', document: changed }); onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法闭合空隙'); }
  };
  return <div ref={tracksRef} className={styles.tracks} aria-label="可编辑时间轴"
    onCopy={event => { if (!commands.current?.canCopy || window.getSelection()?.toString()) return; const value = commands.current.copy(); if (value) { event.preventDefault(); event.clipboardData.setData('text/plain', value.text); event.clipboardData.setData('application/x-lazulite-lyric', commands.current.clipboardToken()); } }}
    onCut={event => { if (!commands.current?.canCopy || window.getSelection()?.toString()) return; const value = commands.current.cut(); if (value) { event.preventDefault(); event.clipboardData.setData('text/plain', value.text); event.clipboardData.setData('application/x-lazulite-lyric', commands.current.clipboardToken()); } }}
    onPaste={event => { event.preventDefault(); commands.current?.paste(event.clipboardData.getData('application/x-lazulite-lyric') === commands.current.clipboardToken() ? undefined : event.clipboardData.getData('text/plain')); }}>
    {menu && createPortal(<EditorContextMenu x={menu.x} y={menu.y} title="时间轴对象操作" close={closeMenu} actions={[
      { label: '复制', disabled: !commands.current?.canCopy, run: () => { commands.current?.copy(); } },
      { label: '剪切', disabled: !commands.current?.canCopy, run: () => { commands.current?.cut(); } },
      { label: '粘贴', disabled: !commands.current?.canPaste, run: () => commands.current?.paste() },
      { label: '删除所选对象', disabled: !selection?.ids.length, run: () => commands.current?.remove() },
    ]} />, window.document.body)}
    <KaraokeTrack startMs={startMs} endMs={endMs} snap={snap} bpm={bpm} anchors={[...externalAnchors,...allTargets.flatMap(target=>{const interval=targetInterval(document,target);return interval?[interval.beginMs,interval.endMs].filter((n):n is number=>n!==null):[];})]} onError={onError}/>
    {visible.line && row('行', overview.filter(item => !editing || lineLayout.lanes.has(item.id)).map(item => bar({ kind: 'line', lineId: item.id }, `时间轴行 L${ordinalById.get(item.backgroundOf ?? item.id)}${item.backgroundOf ? ' 背景' : ''}`, item.beginMs!, item.endMs!)), [], lineLayout.laneCount)}
    <div ref={scrollRef} className={styles.expandedTracks} style={!expandedLines.length ? { display: 'none' } : undefined}><div style={expandedLines.length > 20 ? { height: virtual.getTotalSize(), position: 'relative' } : undefined}>
    {(expandedLines.length > 20 ? virtual.getVirtualItems() : expandedLines.map((line, index) => ({ index, key: line.id, start: 0 }))).map(virtualRow => {
      const item = displayed.lines.find(line => line.id === expandedLines[virtualRow.index].id)!;
      const label = `L${ordinalById.get(item.backgroundOf ?? item.id)}${item.backgroundOf ? ' 背景' : ''}`;
      const renderTargets = (name: string, targets: TimelineTarget[]) => {
        const intervals = targets.filter(target => { const value = targetInterval(projection, target); return value && intersects(value.beginMs, value.endMs); });
        const layout = packIntervals(intervals.map(target => { const value = targetInterval(projection, target)!; return { key: targetId(target), beginMs: value.beginMs!, endMs: value.endMs! }; }));
        return row(`${label} ${name}`, intervals.map(target => { const value = targetInterval(displayed, target)!; const text = 'text' in value ? value.text : 'reading' in value ? value.reading : ''; return bar(target, `时间轴${name} ${text}`, value.beginMs!, value.endMs!, false, layout); }), targets, layout.laneCount, name);
      };
      const targets = allTargets.filter(target => target.lineId === item.id);
      return <section key={item.id} data-index={virtualRow.index} ref={expandedLines.length > 20 ? virtual.measureElement : undefined} className={styles.expandedGroup} style={expandedLines.length > 20 ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` } : undefined} aria-label={`${label} 子轨`}>
        <strong className={styles.groupLabel}>{label}</strong>
        {visible.word && renderTargets('词', targets.filter(target => target.kind === 'word'))}
        {visible.ruby && targets.some(target => target.kind === 'ruby') && renderTargets('注音', targets.filter(target => target.kind === 'ruby'))}
        {visible.romanization && document.translationTracks.map((track,index)=>track.contents.filter(content=>content.lineId===item.id).map(content=>content.kind==='timed'?<div key={content.id} style={{display:'contents'}}>{renderTargets(`翻译 ${track.language??'未指定'} ${index+1}`,targets.filter(target=>target.kind==='romanization'&&target.attachment==='translation'&&target.contentId===content.id))}</div>:row(`${label} 翻译 ${index+1}`,<span data-line-id={item.id} data-translation-id={content.id} tabIndex={0} onClick={()=>setSelection({kind:'romanization-content',attachment:'translation',lineId:item.id,trackId:track.id,contentId:content.id,ids:[content.id],anchorId:content.id,activeId:content.id})} onContextMenu={event=>{event.preventDefault();event.stopPropagation();commands.current?.openContext(event.currentTarget,event.clientX,event.clientY);}}>{content.text}</span>)))}
        {visible.romanization && document.romanizationTracks.map((track, index) => track.contents.filter(content => content.lineId === item.id).map(content => content.kind === 'plain' ? row(`${label} 音译 ${track.language ?? '未指定'} ${index + 1}`, <span title={content.text}>普通音译：{content.text}</span>) : <div key={content.id} style={{ display: 'contents' }}>
          {renderTargets(`音译 ${track.language ?? '未指定'} ${index + 1}`, targets.filter(target => target.kind === 'romanization' && target.contentId === content.id))}
          {content.units.some(unit => unit.beginMs === null || unit.endMs === null) && <button data-role="inline" onClick={() => setSelection({ kind: 'romanization-content', lineId: item.id, trackId: track.id, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id })}>未定时音译：在画布补充时间</button>}
        </div>))}
      </section>;
    })}
    </div></div>
    {visible.gap && line && row('空隙', gaps.map(({ left, right, beginMs, endMs, overlap }) => <button data-role="secondary" disabled={locked} key={`${left.id}:${right.id}`} className={`${styles.gapBar} ${overlap ? styles.overlap : ''}`} style={{ left: pct(beginMs), width: `${Math.max(1, (endMs - beginMs) / spanMs * 100)}%` }} title={overlap ? '消除重叠' : '闭合空隙'} onClick={() => closeGap(left, right)}>{overlap ? '重叠' : '空隙'}</button>))}
  </div>;
}
