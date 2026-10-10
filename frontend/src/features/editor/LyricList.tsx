import { focusObject } from './selection-recovery';
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { LyricLine } from '../../domain/lyric-document';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

export type ListMemory = { offset: number; handled: number | null; measured?: { items: VirtualItem[]; lines: LyricLine[]; width: number; viewport: number; font: string; key: string } };

type Props = {
  memory?: ListMemory;
  pinnedLineIds?: string[];
  lines: LyricLine[];
  append?: () => void;
  lineVersion?: (line: LyricLine) => string;
  renderLine: (line: LyricLine, index: number) => ReactNode;
  locate: { id: string; serial: number; focus?: string; selector?: string; nearest?: boolean } | null;
};

/** Only explicit requests scroll this container. At most two measured corrections. */
type ListProps = Props & { handled: RefObject<number | null> };

function useLocate(scrollRef: RefObject<HTMLDivElement | null>, { lines, locate, handled }: ListProps, mountTarget?: (index: number | null, nearest?: boolean) => void) {
  useEffect(() => {
    if (!locate || handled.current === locate.serial) return;
    const scroller = scrollRef.current!;
    const index = lines.findIndex(line => line.id === locate.id);
    if (index < 0) return;
    const mounted = [...scroller.querySelectorAll<HTMLElement>('[data-line-id]')].some(node => node.dataset.lineId === locate.id);
    if (!locate.nearest || !mounted) mountTarget?.(index, locate.nearest);
    let frame = 0, attempts = 0, corrections = 0, previous = NaN, stable = 0, settledAt = 0;
    const reduced = locate.nearest || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let focused = false;
    const targetTop = () => {
      const line = [...scroller.querySelectorAll<HTMLElement>('[data-line-id]')].find(node => node.dataset.lineId === locate.id);
      const selector = locate.selector ?? locate.focus;
      const target = selector ? line?.querySelector<HTMLElement>(selector) ?? (selector === ':scope' || locate.nearest ? line : null) : line;
      if (!target) return null;
      if (locate.focus && !focused) { focusObject(target); focused = true; handled.current = locate.serial; }
      const row = target.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      const raw = locate.nearest ? scroller.scrollTop + (row.top < view.top ? row.top - view.top : row.bottom > view.bottom ? Math.min(row.top - view.top, row.bottom - view.bottom) : 0) : scroller.scrollTop + row.top - view.top - (row.height >= view.height ? 0 : (view.height - row.height) / 2);
      return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, raw));
    };
    const cancel = () => { handled.current = locate.serial; cancelAnimationFrame(frame); mountTarget?.(null); scroller.scrollTo({ top: scroller.scrollTop, behavior: 'instant' }); };
    const measure = (now: number) => {
      const top = targetTop();
      if (top !== null) {
        stable = Math.abs(top - previous) < 1 ? stable + 1 : 0;
        previous = top;
        if (corrections === 0 && (stable >= 2 || attempts >= 12)) {
          mountTarget?.(null); // Supersede the virtualizer's coarse index reconciliation.
          scroller.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
          handled.current = locate.serial;
          corrections++; settledAt = now + (reduced ? 32 : 650);
        } else if (corrections === 1 && now >= settledAt) {
          if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
          return;
        }
      }
      if (++attempts < 90) frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) cancel(); };
    scroller.addEventListener('wheel', cancel, { passive: true });
    scroller.addEventListener('pointerdown', cancel);
    scroller.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame); mountTarget?.(null);
      scroller.removeEventListener('wheel', cancel);
      scroller.removeEventListener('pointerdown', cancel);
      scroller.removeEventListener('keydown', key);
    };
  }, [locate, lines, mountTarget, scrollRef]);
}

function AppendLine({ append }: { append?: () => void }) {
  return append ? <button data-role="secondary" className={styles.appendLine} aria-label="新增歌词行" onClick={append}><Icon name="add"/></button> : null;
}

function VirtualLyricList(props: ListProps) {
  const { lines, renderLine } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const node = scrollRef.current!; node.scrollTop = props.memory?.offset ?? 0; return () => { if (props.memory) props.memory.offset = node.scrollTop; }; }, []);
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null);
  const focusedIndex = lines.findIndex(line => line.id === focusedLineId);
  const layoutKey = lines.map(line => props.lineVersion?.(line) ?? '').join('\n');
  const cached = props.memory?.measured;
  const font = getComputedStyle(window.document.documentElement).font;
  const virtualizer = useVirtualizer({
    initialMeasurementsCache: cached?.lines === lines && cached.key === layoutKey && cached.viewport === innerWidth && cached.font === font ? cached.items : undefined,
    count: lines.length,
    initialOffset: props.memory?.offset ?? 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => lines[index].id,
    estimateSize: () => 180,
    overscan: 4,
    rangeExtractor: range => {
      const visible = defaultRangeExtractor(range);
      const pinned = lines.flatMap((line, index) => props.pinnedLineIds?.includes(line.id) || index === focusedIndex ? [index] : []);
      return [...new Set([...visible, ...pinned])].sort((a, b) => a - b);
    },
    useFlushSync: false,
  });
  const latestLayout = useRef({ lines, key: layoutKey }); latestLayout.current = { lines, key: layoutKey };
  useLayoutEffect(() => {
    const node = scrollRef.current!;
    let width = node.clientWidth;
    if (cached && cached.width !== width) virtualizer.measure();
    const resize = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; virtualizer.measure(); } });
    resize.observe(node);
    const fonts = () => virtualizer.measure();
    window.document.fonts.addEventListener('loadingdone', fonts);
    return () => {
      resize.disconnect(); window.document.fonts.removeEventListener('loadingdone', fonts);
      if (props.memory) props.memory.measured = { ...latestLayout.current, width, viewport: innerWidth, font: getComputedStyle(window.document.documentElement).font, items: virtualizer.takeSnapshot() };
    };
  }, []);
  // The stable virtualizer instance owns the coarse mount; smooth scrolling uses measured DOM.
  const mountTarget = useRef((index: number | null, nearest = false) => {
    if (index !== null) virtualizer.scrollToIndex(index, { align: nearest ? 'auto' : 'center', behavior: 'auto' });
    else if (scrollRef.current) virtualizer.scrollToOffset(scrollRef.current.scrollTop, { behavior: 'auto' });
  }).current;
  useLocate(scrollRef, props, mountTarget);
  return <div ref={scrollRef} className={styles.lyricScroller} aria-label="歌词列表"
    onFocus={event => setFocusedLineId((event.target as Element).closest('[data-line-id]')?.getAttribute('data-line-id') ?? null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedLineId(null); }}>
    <div className={styles.virtualContent} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(row => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
        className={styles.virtualRow} style={{ transform: `translateY(${row.start}px)` }}>
        {renderLine(lines[row.index], row.index)}
      </div>)}
    </div>
    <AppendLine append={props.append} />
  </div>;
}

function NormalLyricList(props: ListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const node = scrollRef.current!; node.scrollTop = props.memory?.offset ?? 0; return () => { if (props.memory) props.memory.offset = node.scrollTop; }; }, []);
  useLocate(scrollRef, props);
  return <div ref={scrollRef} className={styles.lyricScroller} aria-label="歌词列表">{props.lines.map(props.renderLine)}<AppendLine append={props.append} /></div>;
}

const CachedLine = memo(function CachedLine({ line, index, render }: { line: LyricLine; index: number; version: string; render: RefObject<Props['renderLine']> }) {
  return render.current(line, index);
});

export function LyricList(props: Props) {
  const render = useRef(props.renderLine); render.current = props.renderLine;
  const renderLine = (line: LyricLine, index: number) => <CachedLine key={line.id} line={line} index={index} version={props.lineVersion?.(line) ?? ''} render={render}/>;
  const handled = useRef<number | null>(props.memory?.handled ?? null);
  useEffect(() => () => { if (props.memory) props.memory.handled = handled.current; }, [props.memory]);
  return props.lines.length > 80 ? <VirtualLyricList {...props} renderLine={props.lineVersion ? renderLine : props.renderLine} handled={handled} /> : <NormalLyricList {...props} renderLine={props.lineVersion ? renderLine : props.renderLine} handled={handled} />;
}
