import { useMessageText } from '../../shared/useMessageText';
import { message, MessageError, errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import type { TimeMs } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

function seconds(value: TimeMs) { return value === null ? '' : String(value / 1_000); }
function parseSeconds(value: string): TimeMs {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new MessageError(message('field.nonnegativeSeconds'));
  const number = Math.round(Number(value) * 1_000);
  if (!Number.isSafeInteger(number)) throw new MessageError(message('field.precision'));
  return number;
}

export function DraftInput({ value, label, placeholder, onCommit, onFocus, onSplit, onMove, onNavigate, inputRef, field }: { value: string; label: string; field?: string; placeholder?: string; onCommit: (value: string) => void; onFocus?: () => void; onSplit?: (at: number, draft: string) => void; onMove?: (direction: -1 | 1) => void; onNavigate?: (direction: -1 | 1) => void; inputRef?: (node: HTMLInputElement | null) => void }) {
  useTranslation();
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input data-editor-field={field} ref={(node) => { ref.current = node; inputRef?.(node); }} aria-label={label} placeholder={placeholder} value={draft} onChange={(event) => { cancelled.current = false; setDraft(event.target.value); }} onFocus={() => { if (!ref.current?.closest('[data-pointer-focus], [data-selection-focus]')) onFocus?.(); }}
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
  useTranslation();
  const [start, setStart] = useState(seconds(begin));
  const [finish, setFinish] = useState(seconds(end));
  const [error, setError] = useMessageText('');
  useEffect(() => { setStart(seconds(begin)); setFinish(seconds(end)); }, [begin, end]);
  const commit = () => {
    try {
      const nextBegin = parseSeconds(start), nextEnd = parseSeconds(finish);
      setStart(seconds(nextBegin)); setFinish(seconds(nextEnd));
      setError('');
      if (nextBegin !== begin || nextEnd !== end) onCommit(nextBegin, nextEnd);
    } catch (failure) { setError(errorMessage(failure)); }
  };
  return <span className={styles.times}><input aria-label={t('field.startSeconds',{label})} inputMode="decimal" aria-invalid={Boolean(error)} value={start} onChange={(event) => setStart(event.target.value)} onBlur={commit} /><span>–</span><input aria-label={t('field.endSeconds',{label})} inputMode="decimal" aria-invalid={Boolean(error)} value={finish} onChange={(event) => setFinish(event.target.value)} onBlur={commit} />{error && <small role="alert">{error}</small>}</span>;
}

export function EmptyBeatField({ count, commit, whitespace }: { count: number; commit: (count: number) => boolean; whitespace: boolean }) {
  useTranslation();
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useMessageText('');
  const cancelled = useRef(false);
  useEffect(() => { setDraft(String(count)); setError(''); }, [count]);
  const submit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (!/^\d+$/.test(draft) || Number(draft) > 32) { setError(message('field.emptyBeatRange')); return; }
    if (Number(draft) !== count && !commit(Number(draft))) return;
    setError(''); setDraft(String(Number(draft)));
  };
  return <div><label>{t('editor.emptyBeats')}<input aria-label={t('editor.emptyBeats')} inputMode="numeric" value={draft} aria-invalid={Boolean(error)} onChange={event => setDraft(event.target.value)} onBlur={submit} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(String(count)); setError(''); event.currentTarget.blur(); }
  }}/></label>{error && <small role="alert">{error}</small>}{whitespace && <small>{t('field.whitespaceBeats')}</small>}</div>;
}

const t=i18n.t.bind(i18n);
