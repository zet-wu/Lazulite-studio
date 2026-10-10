import { Fragment, useEffect, useRef, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { type LyricWord, type RubyUnit } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { DraftInput, TimePair } from './EditorFields';
import styles from './semantic-editor.module.css';

type Props = {
  lineId: string;
  word: LyricWord;
  selectedRubyIds: string[];
  placeholderIds?: Set<string>;
  onSelectRuby: (id: string, shift?: boolean, toggle?: boolean) => void;
  apply: (command: LyricCommand) => boolean;
  requestAddSerial?: number;
  requestAfterRubyId?: string | null;
};

export function RubyWordEditor({ lineId, word, selectedRubyIds, placeholderIds, onSelectRuby, apply, requestAddSerial, requestAfterRubyId }: Props) {
  const [newAfter, setNewAfter] = useState<string | null | undefined>(undefined);
  const [newReading, setNewReading] = useState('');
  const [error, setError] = useState('');
  const newInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const finished = useRef(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (requestAddSerial !== undefined) { finished.current = false; setNewAfter(requestAfterRubyId === undefined ? word.rubyUnits.at(-1)?.id ?? null : requestAfterRubyId); setNewReading(''); }
  }, [requestAddSerial]);
  useEffect(() => { if (newAfter !== undefined) newInput.current?.focus(); }, [newAfter, requestAddSerial]);
  const add = () => {
    if (composing.current || finished.current) return;
    const reading = newInput.current?.value ?? newReading;
    finished.current = true;
    if (!reading.trim()) { setNewAfter(undefined); setNewReading(''); return; }
    const id = crypto.randomUUID();
    if (apply({ type: 'insert-ruby', lineId, wordId: word.id, afterRubyId: newAfter ?? null, reading, rubyId: id })) {
      setNewAfter(undefined); setNewReading(''); setError(''); pendingFocus.current = id; onSelectRuby(id);
    } else { finished.current = false; setError('添加失败，请检查读音后重试'); }
  };
  const split = (unit: RubyUnit, atUtf16: number, draft: string) => {
    try {
      const at = utf16ToCodePoint(draft, atUtf16);
      const id = crypto.randomUUID();
      const commands: Extract<LyricCommand, { type: 'edit-ruby' | 'split-ruby' }>[] = [];
      if (draft !== unit.reading) commands.push({ type: 'edit-ruby', lineId, wordId: word.id, rubyId: unit.id, reading: draft });
      commands.push({ type: 'split-ruby', lineId, wordId: word.id, rubyId: unit.id, at, newRubyId: id });
      if (apply({ type: 'batch', commands })) pendingFocus.current = id;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '拆分失败'); }
  };
  const slot = newAfter !== undefined && <div className={styles.rubyTile} key="new-reading"><input ref={newInput} aria-label={`新增读音 ${word.text}`} value={newReading}
    onChange={event => setNewReading(event.target.value)} onBlur={add}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={event => { composing.current = false; if (event.currentTarget !== window.document.activeElement) add(); }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.nativeEvent.isComposing || composing.current) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); finished.current = true; setNewAfter(undefined); setNewReading(''); } }} /></div>;
  return <div className={styles.rubyEditor} aria-label={`注音 ${word.text}`}>
    {(word.rubyUnits.length > 0 || slot) && <div className={styles.rubyAbove}>{newAfter === null && slot}{word.rubyUnits.map((unit) => <Fragment key={unit.id}><div key={unit.id} data-ruby-id={unit.id} data-drag-placeholder={placeholderIds?.has(unit.id) ? '' : undefined} tabIndex={0} className={`${styles.rubyTile} ${selectedRubyIds.includes(unit.id) ? styles.selectedRuby : ''}`}
      onClick={(event) => { event.stopPropagation(); onSelectRuby(unit.id, event.shiftKey, event.ctrlKey || event.metaKey); }}
      onFocus={(event) => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) onSelectRuby(unit.id); }}>
      <DraftInput value={unit.reading} label={`读音 ${word.text}`} onFocus={() => onSelectRuby(unit.id)}
        onCommit={(reading) => apply({ type: 'edit-ruby', lineId, wordId: word.id, rubyId: unit.id, reading })}
        onSplit={(at, draft) => split(unit, at, draft)}
        inputRef={(node) => { if (node) { inputs.current.set(unit.id, node); if (pendingFocus.current === unit.id) { pendingFocus.current = null; node.focus(); } } else inputs.current.delete(unit.id); }} />
      <TimePair begin={unit.beginMs} end={unit.endMs} label={`读音 ${unit.reading}`} onCommit={(beginMs, endMs) => apply({ type: 'set-ruby-time', lineId, wordId: word.id, rubyId: unit.id, beginMs, endMs })} />
    </div>{newAfter === unit.id && slot}</Fragment>)}</div>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
