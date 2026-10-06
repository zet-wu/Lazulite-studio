import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { LyricLine } from '../../domain/lyric-document';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

export type ListMemory = { offset: number; handled: number | null };

type Props = {
  memory?: ListMemory;
  lines: LyricLine[];
  append?: () => void;
  renderLine: (line: LyricLine, index: number) => ReactNode;
  locate: { id: string; serial: number; focus?: string; selector?: string } | null;
};

/** Only explicit requests scroll this container. At most two measured corrections. */
type ListProps = Props & { handled: RefObject<number | null> };

function useLocate(scrollRef: RefObject<HTMLDivElement | null>, { lines, locate, handled }: ListProps, mountTarget?: (index: number | null) => void) {
  useEffect(() => {
    if (!locate || handled.current === locate.serial) return;
    const scroller = scrollRef.current!;
    const index = lines.findIndex(line => line.id === locate.id);
    if (index < 0) return;
    mountTarget?.(index);
    let frame = 0, attempts = 0, corrections = 0, previous = NaN, stable = 0, settledAt = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let focused = false;
    const targetTop = () => {
      const line = [...scroller.querySelectorAll<HTMLElement>('[data-line-id]')].find(node => node.dataset.lineId === locate.id);
      const selector = locate.selector ?? locate.focus;
      const target = selector ? line?.querySelector<HTMLElement>(selector) ?? (selector === ':scope' ? line : null) : line;
      if (!target) return null;
      if (locate.focus && !focused) { target.focus({ preventScroll: true }); focused = true; handled.current = locate.serial; }
      const row = target.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      const raw = scroller.scrollTop + row.top - view.top - (row.height >= view.height ? 0 : (view.height - row.height) / 2);
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
      cancel();
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
  const virtualizer = useVirtualizer({
    count: lines.length,
    initialOffset: props.memory?.offset ?? 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => lines[index].id,
    estimateSize: () => 180,
    overscan: 4,
    rangeExtractor: range => {
      const visible = defaultRangeExtractor(range);
      return focusedIndex < 0 || visible.includes(focusedIndex) ? visible : [...visible, focusedIndex].sort((a, b) => a - b);
    },
    useFlushSync: false,
  });
  // The stable virtualizer instance owns the coarse mount; smooth scrolling uses measured DOM.
  const mountTarget = useRef((index: number | null) => {
    if (index !== null) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
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

export function LyricList(props: Props) {
  const handled = useRef<number | null>(props.memory?.handled ?? null);
  useEffect(() => () => { if (props.memory) props.memory.handled = handled.current; }, [props.memory]);
  return props.lines.length > 80 ? <VirtualLyricList {...props} handled={handled} /> : <NormalLyricList {...props} handled={handled} />;
}
