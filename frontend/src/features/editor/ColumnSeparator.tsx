import { useRef } from 'react';
import { COLUMN_LIMITS, type ColumnSide } from './column-preferences';
import styles from './semantic-editor.module.css';

type Props = { side: ColumnSide; width: number; preferredWidth: number; maximum: number; onChange: (width: number) => void; onCommit: (width: number) => void };
export function ColumnSeparator({ side, width, preferredWidth, maximum, onChange, onCommit }: Props) {
  const drag = useRef<{ original: number; x: number; start: number; current: number } | null>(null);
  const limits = COLUMN_LIMITS[side], direction = side === 'outline' ? 1 : -1;
  const clamp = (value: number) => Math.max(limits.min, Math.min(maximum, value));
  const cancel = () => { if (drag.current) { onChange(drag.current.original); drag.current = null; } };
  return <div className={styles.columnSeparator} role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={side === 'outline' ? '大纲宽度' : '属性栏宽度'} aria-valuemin={limits.min} aria-valuemax={maximum} aria-valuenow={Math.round(width)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { original: preferredWidth, x: event.clientX, start: width, current: width };
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      drag.current.current = clamp(drag.current.start + direction * (event.clientX - drag.current.x));
      onChange(drag.current.current);
    }}
    onPointerUp={event => {
      if (!drag.current) return;
      const current = drag.current; drag.current = null; onCommit(current.current);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={() => onCommit(limits.default)}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); cancel(); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        onCommit(clamp(width + direction * (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 32 : 8)));
      }
    }} />;
}
