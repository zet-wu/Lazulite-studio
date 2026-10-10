import { useEffect, useRef, useState } from 'react';
import type { TimeMs } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

function seconds(value: TimeMs) { return value === null ? '' : String(value / 1_000); }
function parseSeconds(value: string): TimeMs {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('时间必须是非负秒数');
  const number = Math.round(Number(value) * 1_000);
  if (!Number.isSafeInteger(number)) throw new Error('时间超出毫秒精度范围');
  return number;
}

export function DraftInput({ value, label, placeholder, onCommit, onFocus, onSplit, onMove, onNavigate, inputRef }: { value: string; label: string; placeholder?: string; onCommit: (value: string) => void; onFocus?: () => void; onSplit?: (at: number, draft: string) => void; onMove?: (direction: -1 | 1) => void; onNavigate?: (direction: -1 | 1) => void; inputRef?: (node: HTMLInputElement | null) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input ref={(node) => { ref.current = node; inputRef?.(node); }} aria-label={label} placeholder={placeholder} value={draft} onChange={(event) => { cancelled.current = false; setDraft(event.target.value); }} onFocus={() => { if (!ref.current?.closest('[data-pointer-focus]')) onFocus?.(); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; if (event.currentTarget !== document.activeElement && event.currentTarget.value !== value) onCommit(event.currentTarget.value); }}
    onBlur={() => { if (composing.current) return; if (cancelled.current) { cancelled.current = false; return; } if (draft !== value) onCommit(draft); }}
    onKeyDown={(event) => {
      if (composing.current) return;
      if (event.key === 'Enter') ref.current?.blur();
      if (event.key === 'Escape') { cancelled.current = true; setDraft(value); ref.current?.blur(); }
      if (event.key === 'F8' && onSplit) { event.preventDefault(); cancelled.current = true; onSplit(ref.current?.selectionStart ?? 0, draft); }
      if (event.altKey && onMove && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onMove(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.altKey && onNavigate && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onNavigate(event.key === 'ArrowUp' ? -1 : 1); }
    }} />;
}

export function TimePair({ begin, end, label, onCommit }: { begin: TimeMs; end: TimeMs; label: string; onCommit: (begin: TimeMs, end: TimeMs) => void }) {
  const [start, setStart] = useState(seconds(begin));
  const [finish, setFinish] = useState(seconds(end));
  const [error, setError] = useState('');
  useEffect(() => { setStart(seconds(begin)); setFinish(seconds(end)); }, [begin, end]);
  const commit = () => {
    try {
      const nextBegin = parseSeconds(start), nextEnd = parseSeconds(finish);
      setStart(seconds(nextBegin)); setFinish(seconds(nextEnd));
      setError('');
      if (nextBegin !== begin || nextEnd !== end) onCommit(nextBegin, nextEnd);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '时间格式错误'); }
  };
  return <span className={styles.times}><input aria-label={`${label}开始秒数`} inputMode="decimal" aria-invalid={Boolean(error)} value={start} onChange={(event) => setStart(event.target.value)} onBlur={commit} /><span>–</span><input aria-label={`${label}结束秒数`} inputMode="decimal" aria-invalid={Boolean(error)} value={finish} onChange={(event) => setFinish(event.target.value)} onBlur={commit} />{error && <small role="alert">{error}</small>}</span>;
}

export function EmptyBeatField({ count, commit, whitespace }: { count: number; commit: (count: number) => boolean; whitespace: boolean }) {
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  useEffect(() => { setDraft(String(count)); setError(''); }, [count]);
  const submit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (!/^\d+$/.test(draft) || Number(draft) > 32) { setError('请输入 0–32 的整数'); return; }
    if (Number(draft) !== count && !commit(Number(draft))) return;
    setError(''); setDraft(String(Number(draft)));
  };
  return <div><label>后置空拍 <input aria-label="后置空拍" inputMode="numeric" value={draft} aria-invalid={Boolean(error)} onChange={event => setDraft(event.target.value)} onBlur={submit} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(String(count)); setError(''); event.currentTarget.blur(); }
  }}/></label>{error && <small role="alert">{error}</small>}{whitespace && <small>纯空白不参与打轴，也不显示或消费空拍；0 可清除配置。</small>}</div>;
}
