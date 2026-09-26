import { useEffect, useRef, useState } from 'react';
import type { TimeUs } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

function seconds(value: TimeUs) { return value === null ? '' : String(value / 1_000_000); }
function parseSeconds(value: string): TimeUs {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('时间必须是非负秒数');
  const number = Math.round(Number(value) * 1_000_000);
  if (!Number.isSafeInteger(number)) throw new Error('时间超出微秒精度范围');
  return number;
}

export function DraftInput({ value, label, onCommit, onFocus, onSplit, onMergePrevious, onMove, onNavigate, inputRef, readOnly, onEdit, onExit }: { value: string; label: string; onCommit: (value: string) => void; onFocus?: () => void; onSplit?: (at: number, draft: string) => void; onMergePrevious?: (draft: string) => void; onMove?: (direction: -1 | 1) => void; onNavigate?: (direction: -1 | 1) => void; inputRef?: (node: HTMLInputElement | null) => void; readOnly?: boolean; onEdit?: () => void; onExit?: () => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input ref={(node) => { ref.current = node; inputRef?.(node); }} aria-label={label} value={draft} readOnly={readOnly} onChange={(event) => { cancelled.current = false; setDraft(event.target.value); }} onFocus={onFocus} onDoubleClick={onEdit}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => { onExit?.(); if (cancelled.current) { cancelled.current = false; return; } if (draft !== value) onCommit(draft); }}
    onKeyDown={(event) => {
      if (composing.current) return;
      if (readOnly && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); onEdit?.(); return; }
      if (event.key === 'Enter') ref.current?.blur();
      if (event.key === 'Escape') { cancelled.current = true; setDraft(value); ref.current?.blur(); }
      if (event.key === 'F8' && onSplit) { event.preventDefault(); cancelled.current = true; onSplit(ref.current?.selectionStart ?? 0, draft); }
      if (event.key === 'Backspace' && onMergePrevious && ref.current?.selectionStart === 0 && ref.current?.selectionEnd === 0) { event.preventDefault(); cancelled.current = true; onMergePrevious(draft); }
      if (event.altKey && onMove && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onMove(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.altKey && onNavigate && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onNavigate(event.key === 'ArrowUp' ? -1 : 1); }
    }} />;
}

export function TimePair({ begin, end, label, onCommit }: { begin: TimeUs; end: TimeUs; label: string; onCommit: (begin: TimeUs, end: TimeUs) => void }) {
  const [start, setStart] = useState(seconds(begin));
  const [finish, setFinish] = useState(seconds(end));
  const [error, setError] = useState('');
  useEffect(() => { setStart(seconds(begin)); setFinish(seconds(end)); }, [begin, end]);
  const commit = () => {
    try {
      const nextBegin = parseSeconds(start), nextEnd = parseSeconds(finish);
      setError('');
      if (nextBegin !== begin || nextEnd !== end) onCommit(nextBegin, nextEnd);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '时间格式错误'); }
  };
  return <span className={styles.times}><input aria-label={`${label}开始秒数`} inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} onBlur={commit} /><span>–</span><input aria-label={`${label}结束秒数`} inputMode="decimal" value={finish} onChange={(event) => setFinish(event.target.value)} onBlur={commit} />{error && <small role="alert">{error}</small>}</span>;
}
