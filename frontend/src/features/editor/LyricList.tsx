import { useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

type Props = {
  lines: LyricLine[];
  renderLine: (line: LyricLine, index: number) => ReactNode;
  locate: { id: string; serial: number } | null;
};

function VirtualLyricList({ lines, renderLine, locate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledLocate = useRef<number | null>(null);
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null);
  const focusedIndex = lines.findIndex((line) => line.id === focusedLineId);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => lines[index].id,
    estimateSize: () => 180,
    overscan: 4,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      return focusedIndex < 0 || visible.includes(focusedIndex) ? visible : [...visible, focusedIndex].sort((a, b) => a - b);
    },
    useFlushSync: false,
  });

  useEffect(() => {
    if (!locate || handledLocate.current === locate.serial) return;
    const index = lines.findIndex((line) => line.id === locate.id);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'center' });
      handledLocate.current = locate.serial;
    }
  }, [locate, lines, virtualizer]);

  return <div ref={scrollRef} className={styles.lyricScroller} aria-label="歌词列表"
    onFocus={(event) => setFocusedLineId((event.target as Element).closest('[data-line-id]')?.getAttribute('data-line-id') ?? null)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedLineId(null); }}>
    <div className={styles.virtualContent} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
        className={styles.virtualRow} style={{ transform: `translateY(${row.start}px)` }}>
        {renderLine(lines[row.index], row.index)}
      </div>)}
    </div>
  </div>;
}

export function LyricList(props: Props) {
  if (props.lines.length > 80) return <VirtualLyricList {...props} />;
  return <div aria-label="歌词列表">{props.lines.map(props.renderLine)}</div>;
}
