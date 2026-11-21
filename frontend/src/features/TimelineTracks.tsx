import { useTimelineAutoExpand } from '../adapters/timeline-preferences';
import { TimelineStaging } from './TimelineStaging';
import { message as describeMessage, MessageError, errorMessage, type Message } from '../domain/messages';
import { i18n, formatMessage } from '../i18n';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { assertChangedTimes, lyricTimes, projectTimes } from '../domain/time-boundaries';
import { focusObject, selectionSelector, preserveSelectionOnFocus } from './editor/selection-recovery';
import { selectionLineId, selectIds } from './editor/editing-actions';
import { KaraokeContext } from './KaraokeContext';
import { createProjectEditorState, executeProjectCommand } from '../domain/project-document';
import { KaraokeTrack } from './KaraokeTrack';
import { useProjectEditing } from './editor/ProjectEditingContext';
import { projectTimeline } from '../domain/timeline-projection';
import { ContextMenu } from '../shared/ContextMenu';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useEditorSelection } from './editor/SelectionContext';
import { lyricSnapAnchors, stableSnapAnchor, documentTargets, targetId, targetSelection, selectionKind, selectionTargets, targetInterval } from './editor/selection-targets';
import { TimelineIndicators, TimelineIndicatorContext } from './TimelineIndicators';
import { useCallback, useContext, useEffect, useMemo, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { LyricCommand } from '../domain/lyric-commands';
import type { LyricDocument, LyricWord, RomanizationContent } from '../domain/lyric-document';
import { clearTimelineTimes, moveTimeline, resizeTimeline, snapTimelineInterval, snapTimelineTime, timelineDelta, type TimelineTarget } from '../domain/timeline-editing';
import { packIntervals } from '../domain/pack-intervals';
import styles from './media.module.css';

type Props = { follow?: boolean; locked?: boolean; document: LyricDocument; selectedLineId: string | null; startMs: number; endMs: number; positionMs: number; bpm: number; snap: boolean;
  visible: { staging?: boolean; karaoke: boolean; line: boolean; word: boolean; ruby: boolean; gap: boolean; romanization: boolean };
  onLocate?: (begin:number,end:number)=>void;
  externalAnchors?: number[]; durationMs?: number | null;
  apply: (command: LyricCommand) => void; onPan: (startMs: number) => void; onError: (message: string | Message) => void };
type Drag = { pointerY?:number; clear?: boolean; validDrop?: boolean; started: boolean; source: LyricDocument; target: TimelineTarget | null; side: 'move' | 'beginMs' | 'endMs' | 'select' | 'pan'; x: number; y: number; current: number; width: number; originalMs: number; candidate: { timeMs: number; document: LyricDocument; error: string | Message } };
const timed = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end >= begin;

export function TimelineTracks({ follow = false, locked, document, selectedLineId, startMs, endMs, positionMs, bpm, snap, visible, externalAnchors = [], durationMs = null, apply, onLocate, onPan, onError }: Props) {
  useTranslation();
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
  const { selection, setSelection, expanded, commands, area, focusRequest, requestFocus } = useEditorSelection()!;
  const [autoExpand] = useTimelineAutoExpand();
  const activeLineIds = autoExpand === 'always' || autoExpand === 'follow' && follow
    ? document.lines.filter(line => line.beginMs !== null && line.endMs !== null && line.beginMs <= positionMs && positionMs < line.endMs).map(line => line.id) : [];
  const activeKey = activeLineIds.join(':');
  const [focusedTargetId, setFocusedTargetId] = useState<string | null>(null);
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  const heldTargetIds = [focusedTargetId, drag?.target ? targetId(drag.target) : null, menu?.target.dataset.timelineKey];
  const heldLineIds = [focusedLineId, drag?.target?.lineId, menu?.target.closest<HTMLElement>('[data-expanded-line]')?.dataset.expandedLine];
  const projection = useMemo(() => projectTimeline(document, durationMs), [document, durationMs]);
  const intersects = (begin: number | null, end: number | null) => timed(begin, end) && end! >= startMs && begin! <= endMs;
  const expandedLines = projection.lines.filter(line => {
    if (!expanded.includes(line.id) && !activeLineIds.includes(line.id) && !heldLineIds.includes(line.id)) return false;
    if (!(visible.word || visible.ruby && line.words.some(word => word.rubyUnits.length) || visible.romanization && [...document.romanizationTracks,...document.translationTracks].some(track => track.contents.some(content => content.lineId === line.id)))) return false;
    return heldLineIds.includes(line.id) || intersects(line.beginMs, line.endMs)
      || line.words.some(word => visible.word && intersects(word.beginMs,word.endMs) || visible.ruby && word.rubyUnits.some(unit => intersects(unit.beginMs,unit.endMs)))
      || visible.romanization && [...projection.translationTracks,...projection.romanizationTracks].some(track => track.contents.some(content => content.lineId === line.id && content.kind === 'timed' && content.units.some(unit => intersects(unit.beginMs,unit.endMs))));
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: expandedLines.length, getScrollElement: () => scrollRef.current, estimateSize: () => 80, overscan: 3, getItemKey: index => expandedLines[index].id,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...expandedLines.flatMap((line,index) => heldLineIds.includes(line.id) ? [index] : [])])].sort((a,b) => a-b) });
  useEffect(() => {
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[role="menu"]')) return;
      setFocusedTargetId(tracksRef.current?.contains(target) ? target.closest<HTMLElement>('[data-timeline-key]')?.dataset.timelineKey ?? null : null);
      setFocusedLineId(tracksRef.current?.contains(target) ? target.closest<HTMLElement>('[data-expanded-line]')?.dataset.expandedLine ?? null : null);
    };
    window.addEventListener('focusin', focus);
    return () => window.removeEventListener('focusin', focus);
  }, []);
  useLayoutEffect(() => {
    if (!activeLineIds.length || drag || menu) return;
    const index = expandedLines.findIndex(line => activeLineIds.includes(line.id));
    if (index < 0) return;
    if (expandedLines.length > 20) virtual.scrollToIndex(index, {align:'auto'});
    else tracksRef.current?.querySelector<HTMLElement>(`[data-expanded-line="${CSS.escape(expandedLines[index].id)}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  }, [activeKey, expandedLines.length]);
  useEffect(() => { setMenu(null); }, [document, locked]);
  const closeMenu = () => setMenu(null);
  const allTargets = useMemo(() => documentTargets(document), [document]);
  const choose = (target: TimelineTarget, shift = false, toggle = false) => {
    const id = targetId(target), previous = selection?.kind === selectionKind(target) && (target.kind!=='romanization'||(selection.kind==='romanization-unit'&&selection.attachment===target.attachment)) ? selection : null;
    const order = allTargets.filter(item => item.kind === target.kind && (target.kind!=='romanization'||item.kind==='romanization'&&item.attachment===target.attachment) && (!shift || target.kind !== 'romanization' || item.kind === 'romanization' && item.trackId === target.trackId)).map(targetId);
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection(targetSelection(target, ids, shift || toggle ? previous?.anchorId ?? id : id));
  };
  const contentBar = (trackId: string, content: Extract<RomanizationContent,{kind:'plain'}>, attachment?: 'translation') => {
    const previous=selection?.kind==='romanization-content'&&selection.attachment===attachment&&selection.trackId===trackId?selection:null;
    const chooseContent=(shift=false,toggle=false)=>{
      const tracks=attachment==='translation'?document.translationTracks:document.romanizationTracks;
      const order=tracks.find(track=>track.id===trackId)!.contents.filter(item=>item.lineId===content.lineId).map(item=>item.id);
      const ids=selectIds(order,previous?.ids??[],previous?.anchorId??content.id,content.id,shift,toggle);
      setSelection({kind:'romanization-content',...(attachment?{attachment}:{}),lineId:content.lineId,trackId,contentId:content.id,ids,activeId:content.id,anchorId:shift||toggle?previous?.anchorId??content.id:content.id});
    };
    return <span role="button" tabIndex={0} className={previous?.ids.includes(content.id)?styles.trackSelected:undefined} title={content.text} aria-pressed={!!previous?.ids.includes(content.id)} data-line-id={content.lineId} data-translation-id={attachment?content.id:undefined} data-romanization-content-id={!attachment?content.id:undefined}
      onClick={event=>chooseContent(event.shiftKey,event.ctrlKey||event.metaKey)}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseContent(event.shiftKey,event.ctrlKey||event.metaKey);}if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();commands.current?.openContext(event.currentTarget,rect.left,rect.bottom);}}}
      onContextMenu={event=>{event.preventDefault();event.stopPropagation();commands.current?.openContext(event.currentTarget,event.clientX,event.clientY);}}>{content.text}</span>;
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
  useEffect(() => { cancel(); }, [document, locked, durationMs, visible.staging, visible.line, visible.word, visible.ruby, visible.romanization, cancel]);
  const previousViewport = useRef({startMs,endMs});
  useEffect(() => {
    const previous=previousViewport.current;previousViewport.current={startMs,endMs};
    if(dragRef.current?.side!=='pan' && (!follow || endMs-startMs!==previous.endMs-previous.startMs)) cancel();
  }, [startMs,endMs,follow,cancel]);
  const candidateDocument = drag?.clear ? document : drag?.candidate.document ?? document;
  const displayed = projectTimeline(candidateDocument, durationMs);
  const propsEndMs = endMs;
  const spanMs = Math.max(1, endMs - startMs);
  const mainLines = displayed.lines;
  const ordinalById = new Map(mainLines.filter(item => !item.backgroundOf).map((item, index) => [item.id, index + 1]));
  const line = displayed.lines.find((item) => item.id === selectedLineId);
  const overview = mainLines.filter(item => intersects(item.beginMs, item.endMs) || timed(item.beginMs,item.endMs) && heldTargetIds.includes(item.id));
  const currentLayout = useMemo(() => packIntervals(projection.lines.filter(item => intersects(item.beginMs, item.endMs) || timed(item.beginMs,item.endMs) && heldTargetIds.includes(item.id)).map(item => ({ key: item.id, beginMs: item.beginMs!, endMs: item.endMs! }))), [projection, startMs, endMs, focusedTargetId, menu]);
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
    window.getSelection()?.removeAllRanges();
    onError('');
    if (target) {
      const node = event.currentTarget.closest<HTMLElement>('[data-timeline-key]');
      if (node) focusObject(node);
      if (event.shiftKey || event.ctrlKey || event.metaKey || !selectionTargets(document, selection).some(item => targetId(item) === targetId(target))) choose(target, event.shiftKey, event.ctrlKey || event.metaKey);
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    }
    const lane = (event.currentTarget.closest('[data-track-lane]') ?? tracksRef.current!.querySelector('[data-track-lane]')) as HTMLElement;
    const next: Drag = { started: false, source: document, target, side, x: event.clientX, y: event.clientY, current: event.clientX, width: lane.getBoundingClientRect().width, originalMs, candidate: { timeMs: originalMs, document, error: '' } };
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
    const hit = window.document.elementFromPoint(event.clientX,event.clientY);
    const drop = hit?.closest('[data-staging-drop]');
    if (current.side === 'move' && current.target && drop && tracksRef.current?.contains(drop)) {
      const candidate: Drag['candidate'] = {timeMs:current.originalMs,document,error:''};
      try {
        candidate.document = clearTimelineTimes(document,moving,editing);
        if(projectContext) executeProjectCommand(createProjectEditorState(projectContext.project),{type:'lyrics',command:{type:'replace-document',document:candidate.document}});
      } catch(cause) { candidate.error = errorMessage(cause); }
      const next = {...current,clear:true,validDrop:true,current:event.clientX,pointerY:event.clientY,started:current.started || Math.hypot(event.clientX-current.x,event.clientY-current.y)>=3,candidate};
      dragRef.current=next;setDrag(next);publish(null);return;
    }
    const validDrop = !!hit?.closest('[data-track-lane]') && !!hit && !!tracksRef.current?.contains(hit);
    const excluded = (item: TimelineTarget) => moving.some(target => targetId(target) === targetId(item) || current.side === 'move' && (target.kind === 'line' && item.lineId === target.lineId || target.kind === 'word' && item.kind === 'ruby' && item.wordId === target.wordId));
    // Parent envelopes and linked ends can change indirectly. Compare endpoint
    // identities against the unsnapped edit, preserving unrelated equal times.
    let unsnapped = document;
    if (current.target) try {
      unsnapped = current.side === 'move' ? moveTimeline(document, moving, delta, editing)
        : resizeTimeline(document, current.target, current.side as 'beginMs' | 'endMs', proposed, editing);
    } catch { /* Invalid candidates still receive the normal validation below. */ }
    const options=lyricSnapAnchors(document,current.side==='move'?null:unsnapped,excluded,externalAnchors);
    if(bpm>0)for(let time=Math.ceil(startMs/(60000/bpm))*(60000/bpm);time<=endMs&&options.length<20000;time+=60000/bpm)options.push({time:Math.round(time)});
    const validate=(next:LyricDocument,time:number)=>{
      if(durationMs===null)throw new MessageError(describeMessage('timeline.sourceUnknown'));
      if(projectContext){
        const command:LyricCommand=current.side==='move'&&moving.every(item=>item.kind==='line')?{type:'shift-lines',lineIds:moving.map(item=>item.lineId),deltaMs:time-current.originalMs}:{type:'replace-document',document:next};
        const nextProject=executeProjectCommand(createProjectEditorState(projectContext.project),{type:'lyrics',command});
        assertChangedTimes(projectTimes(projectContext.project),projectTimes(nextProject.present),durationMs);
      }else assertChangedTimes(lyricTimes(document),lyricTimes(next),durationMs);
    };
    let timeMs=proposed;
    if(current.side==='move'&&current.target){
      const interval=targetInterval(document,current.target)!;
      const correction=snapTimelineInterval(interval.beginMs!+delta,interval.endMs!+delta,options.map(option=>option.time),spanMs,current.width,snap,(correction,index)=>{
        try{const next=moveTimeline(document,moving,delta+correction,editing);validate(next,proposed+correction);return stableSnapAnchor(options[index],next);}catch{return false;}
      });
      timeMs+=correction;
    }else if(current.side!=='select'&&current.side!=='pan')timeMs=snapTimelineTime(proposed,options.map(option=>option.time),spanMs,current.width,snap);
    const candidate: Drag['candidate'] = { timeMs, document, error: '' };
    if (current.target && Math.abs(event.clientX - current.x) >= 3) {
      const target = current.target;
      try {
        if (durationMs === null) throw new MessageError(describeMessage('timeline.sourceUnknown'));
        candidate.document = current.side === 'move'
          ? moveTimeline(document, moving, timeMs - current.originalMs, editing)
          : resizeTimeline(document, target, current.side as 'beginMs' | 'endMs', timeMs, editing);
        validate(candidate.document,timeMs);
      } catch (cause) { candidate.error = errorMessage(cause); }
    } else if (current.target) candidate.timeMs = current.originalMs;
    const next = { ...current, clear:false, validDrop, pointerY:event.clientY, started: current.started || Math.abs(event.clientX - current.x) >= 3, current: event.clientX, candidate };
    dragRef.current = next; setDrag(next);
    if (next.side === 'pan') { if (Math.abs(next.current - next.x) >= 4) onPan(next.originalMs - delta); }
    else publish({ timeMs: candidate.timeMs, valid: !candidate.error });
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.target && dragRef.current.started) move(event);
    const current = dragRef.current;
    cancel();
    if (!current || current.source !== document || current.side === 'pan') return;
    if (current.side === 'select') {
      const first = current.originalMs, last = current.candidate.timeMs;
      const picked = boxTargets.current.filter(target => { const item = targetInterval(projection, target); return item && item.beginMs !== null && item.endMs !== null && item.beginMs < Math.max(first, last) && item.endMs > Math.min(first, last); });
      if (picked.length) setSelection(targetSelection(picked.at(-1)!, picked.map(targetId), targetId(picked[0])));
      return;
    }
    if (!current.target || !current.started) {
      if (current.target) choose(current.target);
      return;
    }
    if (!current.validDrop) return;
    if (current.candidate.error) { onError(current.candidate.error); return; }
    const moving = selectionTargets(document, selection).some(item => targetId(item) === targetId(current.target!)) ? selectionTargets(document, selection) : [current.target];
    try {
      apply(!current.clear && current.side === 'move' && moving.every(target => target.kind === 'line')
      ? { type: 'shift-lines', lineIds: moving.map(target => target.lineId), deltaMs: current.candidate.timeMs - current.originalMs }
      : { type: 'replace-document', document: current.candidate.document }); onError('');
      if(current.clear) requestFocus(selection,'timeline');
    } catch(cause) { onError(errorMessage(cause)); }
  };
  useEffect(() => {
    if (focusRequest?.area !== 'timeline' || focusRequest.selection !== selection) return;
    const wanted = focusRequest.selection;
    const focusTimeline=()=>focusObject(tracksRef.current!.querySelector<HTMLElement>('[data-staging-drop]') ?? tracksRef.current!.closest<HTMLElement>('#timeline-plots')!);
    if (!wanted) { focusTimeline(); return; }
    const lineId = selectionLineId(wanted)!;
    const index = expandedLines.findIndex(line => line.id === lineId);
    if (expandedLines.length > 20 && index >= 0 && !virtual.getVirtualItems().some(item => item.index === index)) virtual.scrollToIndex(index, { align: 'auto' });
    const target = selectionTargets(projection, wanted).find(item => targetId(item) === wanted.activeId);
    const interval = target && targetInterval(projection, target);
    if (interval?.beginMs != null && interval.endMs != null) {
      if (interval.beginMs < startMs) onPan(interval.beginMs);
      else if (interval.beginMs > endMs) onPan(Math.max(0, interval.beginMs - (endMs - startMs) + 100));
    }
    let frame = 0, attempts = 0;
    const focus = () => {
      const selector = wanted.kind === 'romanization-content' ? `${selectionSelector(wanted)}:not([data-timeline-key])` : `[data-timeline-key="${CSS.escape(wanted.activeId)}"]`;
      const exact = tracksRef.current?.querySelector<HTMLElement>(`[data-staging-key="${CSS.escape(wanted.activeId)}"]`) ?? tracksRef.current?.querySelector<HTMLElement>(selector);
      if (exact) { focusObject(exact); exact.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
      if (++attempts < 12) { frame = requestAnimationFrame(focus); return; }
      const parent = tracksRef.current?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(lineId)}"]`);
      if (parent) {
        focusObject(parent);
      } else focusTimeline();
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, selection]);
  const boxTargets = useRef<TimelineTarget[]>([]);
  const bar = (target: TimelineTarget, label: string, beginMs: number, endMs: number, active = false, laneLayoutOverride?: ReturnType<typeof packIntervals>, caption = label) => {
    const key = target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;
    const layout = laneLayoutOverride ?? lineLayout;
    const real = targetInterval(candidateDocument, target);
    const playing = real?.beginMs != null && real?.endMs != null && positionMs >= real.beginMs && positionMs < real.endMs;
    const ghostBegin = real?.beginMs === null, ghostEnd = real?.endMs === null;
    const description = ghostBegin || ghostEnd ? t('timeline.temporary',{side:t(ghostBegin?'time.begin':'time.end'),time:ghostBegin?beginMs:endMs}) : undefined;
    active = selection?.kind === selectionKind(target) && selection.ids.includes(key) || false;
    const outside = endMs < startMs || beginMs > propsEndMs;
    const clippedBegin = outside ? beginMs : Math.max(startMs, beginMs);
    const right = Math.min(endMs, propsEndMs);
    const narrow = (Math.min(endMs, propsEndMs) - clippedBegin) / spanMs * plotWidth < 16;
    return <div key={key} data-timeline-key={key} data-line-id={target.lineId} data-word-id={target.kind==='word'||target.kind==='ruby'?target.wordId:undefined} data-ruby-id={target.kind==='ruby'?target.rubyId:undefined} data-romanization-content-id={target.kind==='romanization'&&!target.attachment?target.contentId:undefined} data-romanization-unit-id={target.kind==='romanization'&&!target.attachment?target.unitId:undefined} data-translation-id={target.kind==='romanization'&&target.attachment?target.contentId:undefined} data-translation-unit-id={target.kind==='romanization'&&target.attachment?target.unitId:undefined}
      className={`${styles.trackBar} ${target.kind === 'line' && document.lines.find(line => line.id === target.lineId)?.backgroundOf ? styles.backgroundBar : ''} ${active ? styles.trackSelected : ''} ${narrow ? styles.narrowHit : ''} ${playing ? styles.trackPlaying : ''}`} role="button" aria-current={playing ? "time" : undefined} aria-disabled={locked} tabIndex={0} aria-label={label} title={description} aria-description={description} data-temporary-begin={ghostBegin || undefined} data-temporary-end={ghostEnd || undefined}
      style={{ transform: narrow && beginMs === endMs && beginMs === propsEndMs ? 'translateX(-100%)' : undefined, left: pct(clippedBegin), width: `${Math.max(0, right - clippedBegin) / spanMs * 100}%`, top: `calc(${layout.lanes.get(key) ?? 0} * var(--timeline-lane-height) + var(--timeline-bar-inset))`, height: 'var(--timeline-bar-height)' }}
      onPointerDown={(event) => begin(event, target, 'move', beginMs)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onFocus={event => { if (!preserveSelectionOnFocus(selection, event.currentTarget) && !dragRef.current) choose(target); }}
      onContextMenu={event => { event.preventDefault(); if(locked)return; event.stopPropagation(); if(!commands.current?.openContext(event.currentTarget,event.clientX,event.clientY)){choose(target); setMenu({ x: event.clientX, y: event.clientY, target: event.currentTarget });} }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(target, event.shiftKey, event.ctrlKey || event.metaKey); }
        if (!locked && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); if(!commands.current?.openContext(event.currentTarget,box.left,box.bottom)){choose(target);setMenu({ x: box.left, y: box.bottom, target: event.currentTarget });} }
        if (event.key === 'Delete' && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !dragRef.current) { event.preventDefault(); event.stopPropagation(); commands.current?.remove(); }
      }}>
      {narrow && <><span data-time-color className={styles.narrowColor} style={{ width: (right - clippedBegin) / spanMs * plotWidth }} /><span className={styles.narrowMarker} title={t('timeline.narrow')} /></>}
      {(!narrow || ghostBegin) && beginMs >= startMs && <span className={`${styles.trackHandle} ${ghostBegin ? styles.temporaryHandle : ''}`} title={ghostBegin ? description : undefined} aria-label={t('timeline.beginBoundary',{label})} onPointerDown={(event) => begin(event, target, 'beginMs', beginMs)} onPointerMove={move} onPointerUp={finish} />}
      <span className={styles.trackBarText}>{caption}</span>
      {(!narrow || ghostEnd) && endMs <= propsEndMs && <span className={`${styles.trackHandle} ${ghostEnd ? styles.temporaryHandle : ''}`} title={ghostEnd ? description : undefined} aria-label={t('timeline.endBoundary',{label})} onPointerDown={(event) => begin(event, target, 'endMs', endMs)} onPointerMove={move} onPointerUp={finish} />}
    </div>;
  };
  const row = (name: string, content: React.ReactNode, selectable: TimelineTarget[] = [], laneCount = 1, caption = name, assignmentKind?: TimelineTarget['kind']) => <div className={styles.trackRow} key={selectable.length?selectable.map(targetId).join(':'):name}><strong data-timeline-text title={caption}>{caption}</strong><div data-wheel-zoom data-track-lane data-assignment-kind={assignmentKind ?? selectable[0]?.kind} className={styles.trackLane} style={{ height: `calc(${Math.max(1, laneCount)} * var(--timeline-lane-height))` }}
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
    } catch (cause) { onError(errorMessage(cause)); }
  };
  return <div ref={tracksRef} className={styles.tracks} data-editable-timeline aria-label={t('timeline.editable')} tabIndex={-1} onFocusCapture={() => { area.current = 'timeline'; }}
    onKeyDown={event => { if (event.key === 'Delete' && !locked && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !dragRef.current) { event.preventDefault(); event.stopPropagation(); commands.current?.remove(); } }}
    onCopy={event => { if ((event.target as Element).closest('input,textarea,[contenteditable="true"]')) return; if (!commands.current?.canCopy || window.getSelection()?.toString()) return; const value = commands.current.copy(); if (value) { event.preventDefault(); event.clipboardData.setData('text/plain', value.text); event.clipboardData.setData('application/x-lazulite-lyric', commands.current.clipboardToken()); } }}
    onCut={event => { if ((event.target as Element).closest('input,textarea,[contenteditable="true"]')) return; if (!commands.current?.canCopy || window.getSelection()?.toString()) return; const value = commands.current.cut(); if (value) { event.preventDefault(); event.clipboardData.setData('text/plain', value.text); event.clipboardData.setData('application/x-lazulite-lyric', commands.current.clipboardToken()); } }}
    onPaste={event => { if ((event.target as Element).closest('input,textarea,[contenteditable="true"]')) return; event.preventDefault(); commands.current?.paste(event.clipboardData.getData('application/x-lazulite-lyric') === commands.current.clipboardToken() ? undefined : event.clipboardData.getData('text/plain')); }}>
    {drag?.candidate.error && createPortal(<p role="alert" className={styles.dragError} style={{left:Math.max(8,Math.min(drag.current+12,window.innerWidth-328)),top:Math.min((drag.pointerY??drag.y)+12,window.innerHeight-60)}}>{typeof drag.candidate.error==='string'?drag.candidate.error:formatMessage(drag.candidate.error)}</p>,window.document.body)}
    {menu && !locked && <ContextMenu target={menu.target} x={menu.x} y={menu.y} title={t('timeline.menu')} close={closeMenu} actions={[
      { label: t('common.copy'), disabled: !commands.current?.canCopy, run: () => { commands.current?.copy(); } },
      { label: t('common.cut'), disabled: !commands.current?.canCopy, run: () => { commands.current?.cut(); } },
      { label: t('common.paste'), disabled: !commands.current?.canPaste, run: () => commands.current?.paste() },
      { label:t('timeline.clearTimes'), disabled:!selectionTargets(document,selection).length, run:()=>{try{apply({type:'replace-document',document:clearTimelineTimes(document,selectionTargets(document,selection),editing)});requestFocus(selection,'timeline');}catch(cause){onError(errorMessage(cause));}} },
      { danger:true, label: t('timeline.deleteSelected'), disabled: !selection?.ids.length, run: () => commands.current?.remove() },
    ]} />}
    {visible.karaoke && <KaraokeTrack durationMs={durationMs} startMs={startMs} endMs={endMs} snap={snap} bpm={bpm} anchors={[...externalAnchors,...allTargets.flatMap(target=>{const interval=targetInterval(document,target);return interval?[interval.beginMs,interval.endMs].filter((n):n is number=>n!==null):[];})]} onError={onError}/>}
    {visible.line && row('lines', overview.filter(item => !editing || lineLayout.lanes.has(item.id)).map(item => {
      const number = ordinalById.get(item.backgroundOf ?? item.id);
      const background = item.backgroundOf ? ` ${t('outline.background')}` : '';
      return bar({ kind: 'line', lineId: item.id }, t('timeline.lineLabel', { number, background }), item.beginMs!, item.endMs!, false, undefined, `L${number}${background}`);
    }), [], lineLayout.laneCount,t('edit.lineUnit'),'line')}
    <div ref={scrollRef} className={styles.expandedTracks} style={!expandedLines.length ? { display: 'none' } : undefined}><div style={expandedLines.length > 20 ? { height: virtual.getTotalSize(), position: 'relative' } : undefined}>
    {(expandedLines.length > 20 ? virtual.getVirtualItems() : expandedLines.map((line, index) => ({ index, key: line.id, start: 0 }))).map(virtualRow => {
      const item = displayed.lines.find(line => line.id === expandedLines[virtualRow.index].id)!;
      const label = `L${ordinalById.get(item.backgroundOf ?? item.id)}${item.backgroundOf ? ` ${t('outline.background')}` : ''}`;
      const renderTargets = (name: string, targets: TimelineTarget[]) => {
        const intervals = targets.filter(target => { const value = targetInterval(projection, target); return value && timed(value.beginMs,value.endMs) && (intersects(value.beginMs, value.endMs) || heldTargetIds.includes(targetId(target))); });
        if (!intervals.length && !heldLineIds.includes(item.id)) return null;
        const layout = packIntervals(intervals.map(target => { const value = targetInterval(projection, target)!; return { key: targetId(target), beginMs: value.beginMs!, endMs: value.endMs! }; }));
        return row(`${label} ${name}`, intervals.map(target => { const value = targetInterval(displayed, target)!; const text = 'text' in value ? value.text : 'reading' in value ? value.reading : ''; return bar(target, t('timeline.itemLabel',{name,text}), value.beginMs!, value.endMs!, false, layout, text); }), targets, layout.laneCount, name);
      };
      const targets = allTargets.filter(target => target.lineId === item.id);
      return <section key={item.id} data-expanded-line={item.id} data-index={virtualRow.index} ref={expandedLines.length > 20 ? virtual.measureElement : undefined} className={styles.expandedGroup} style={expandedLines.length > 20 ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` } : undefined} aria-label={t('timeline.subtracks',{label})}>
        <strong className={styles.groupLabel}>{label}</strong>
        {visible.word && renderTargets(t('selection.word'), targets.filter(target => target.kind === 'word'))}
        {visible.ruby && targets.some(target => target.kind === 'ruby') && renderTargets(t('batch.reading'), targets.filter(target => target.kind === 'ruby'))}
        {visible.romanization && document.translationTracks.map((track,index)=>track.contents.filter(content=>content.lineId===item.id).map(content=>content.kind==='timed'?<div key={content.id} style={{display:'contents'}}>{renderTargets(t('timeline.translationLabel',{language:track.language??t('common.unspecified'),number:index+1}),targets.filter(target=>target.kind==='romanization'&&target.attachment==='translation'&&target.contentId===content.id))}</div>:row(`${item.id}:translation:${track.id}:${content.id}`,contentBar(track.id,content,'translation'),[],1,`${label} ${t('timeline.translationLabel',{language:'',number:index+1})}`)))}
        {visible.romanization && document.romanizationTracks.map((track, index) => track.contents.filter(content => content.lineId === item.id).map(content => content.kind === 'plain' ? row(`${item.id}:romanization:${track.id}:${content.id}`,contentBar(track.id,content),[],1,`${label} ${t('timeline.romanizationLabel',{language:track.language??t('common.unspecified'),number:index+1})}`) : <div key={content.id} style={{ display: 'contents' }}>
          {renderTargets(t('timeline.romanizationLabel',{language:track.language??t('common.unspecified'),number:index+1}), targets.filter(target => target.kind === 'romanization' && target.contentId === content.id))}
          {content.units.some(unit => unit.beginMs === null || unit.endMs === null) && <button data-role="inline" onClick={() => setSelection({ kind: 'romanization-content', lineId: item.id, trackId: track.id, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id })}>{t('timeline.untimedRomanization')}</button>}
        </div>))}
      </section>;
    })}
    </div></div>
    {visible.gap && line && row('gaps', gaps.map(({ left, right, beginMs, endMs, overlap }) => <button data-role="secondary" disabled={locked} key={`${left.id}:${right.id}`} className={`${styles.gapBar} ${overlap ? styles.overlap : ''}`} style={{ left: pct(beginMs), width: `${Math.max(1, (endMs - beginMs) / spanMs * 100)}%` }} title={overlap ? t('timeline.removeOverlap') : t('timeline.closeGap')} onClick={() => closeGap(left, right)}>{overlap ? t('timeline.overlap') : t('timeline.gap')}</button>),[],1,t('timeline.gap'))}
    {visible.staging !== false && <TimelineStaging clearPreview={drag?.clear} document={document} startMs={startMs} endMs={endMs} durationMs={durationMs} snap={snap} bpm={bpm} anchors={externalAnchors} locked={locked} visible={visible} host={tracksRef} apply={apply} onLocate={onLocate} onError={onError}/>}
  </div>;
}

const t=i18n.t.bind(i18n);
