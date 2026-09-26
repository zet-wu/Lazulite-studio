import { useEffect, useRef, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { type LyricWord, type RubyUnit } from '../../domain/lyric-document';
import { distributeRubyTime, splitReadingMora } from '../../domain/ruby-editing';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { DraftInput, TimePair } from './EditorFields';
import styles from './semantic-editor.module.css';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const firstSplitOffset = (reading: string) => {
  const iterator = segmenter.segment(reading)[Symbol.iterator]();
  const first = iterator.next();
  return first.done || iterator.next().done ? null : first.value.segment.length;
};

type Props = {
  lineId: string;
  word: LyricWord;
  selectedRubyId: string | null;
  onSelectRuby: (id: string) => void;
  apply: (command: LyricCommand) => boolean;
  requestAddSerial?: number;
};

export function RubyWordEditor({ lineId, word, selectedRubyId, onSelectRuby, apply, requestAddSerial }: Props) {
  const [newAfter, setNewAfter] = useState<string | null | undefined>(undefined);
  const [newReading, setNewReading] = useState('');
  const [error, setError] = useState('');
  const newInput = useRef<HTMLInputElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (requestAddSerial !== undefined) { setNewAfter(word.rubyUnits.at(-1)?.id ?? null); setNewReading(''); }
  }, [requestAddSerial]);
  useEffect(() => { if (newAfter !== undefined) newInput.current?.focus(); }, [newAfter]);
  const add = () => {
    if (!newReading) return;
    const id = crypto.randomUUID();
    if (apply({ type: 'insert-ruby', lineId, wordId: word.id, afterRubyId: newAfter ?? null, reading: newReading, rubyId: id })) {
      setNewAfter(undefined); setNewReading(''); pendingFocus.current = id;
    }
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
  const merge = (unit: RubyUnit, previous: RubyUnit, draft: string) => {
    const commands: Extract<LyricCommand, { type: 'edit-ruby' | 'merge-ruby' }>[] = [];
    if (draft !== unit.reading) commands.push({ type: 'edit-ruby', lineId, wordId: word.id, rubyId: unit.id, reading: draft });
    commands.push({ type: 'merge-ruby', lineId, wordId: word.id, firstRubyId: previous.id, secondRubyId: unit.id });
    if (apply({ type: 'batch', commands })) pendingFocus.current = previous.id;
  };
  const splitMora = () => {
    try {
      if (word.alignmentUnits.some((unit) => unit.rubyUnitId)) throw new Error('带对齐结果的读音不能自动拆分');
      const units = word.rubyUnits.flatMap((unit) => {
        const parts = splitReadingMora(unit.reading);
        if (parts.length <= 1) return [unit];
        const children = parts.map((reading, index) => ({ ...unit, id: index === 0 ? unit.id : crypto.randomUUID(), reading }));
        return distributeRubyTime({ ...word, beginUs: unit.beginUs, endUs: unit.endUs }, children);
      });
      if (units.length > word.rubyUnits.length) apply({ type: 'set-ruby-units', lineId, wordId: word.id, units, overwrite: true });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读音分词失败'); }
  };
  return <div className={styles.rubyEditor} aria-label={`Ruby ${word.text}`}>
    {word.rubyUnits.length > 0 && <div className={styles.rubyAbove}>{word.rubyUnits.map((unit, index) => <div key={unit.id} data-ruby-id={unit.id} className={`${styles.rubyTile} ${selectedRubyId === unit.id ? styles.selectedRuby : ''}`}>
      <DraftInput value={unit.reading} label={`读音 ${word.text}`} onFocus={() => onSelectRuby(unit.id)}
        onCommit={(reading) => apply({ type: 'edit-ruby', lineId, wordId: word.id, rubyId: unit.id, reading })}
        onSplit={(at, draft) => split(unit, at, draft)}
        onMergePrevious={index > 0 ? (draft) => merge(unit, word.rubyUnits[index - 1], draft) : undefined}
        inputRef={(node) => { if (node) { inputs.current.set(unit.id, node); if (pendingFocus.current === unit.id) { pendingFocus.current = null; node.focus(); } } else inputs.current.delete(unit.id); }} />
      <div className={styles.rubyTileActions}>
        <button aria-label={`在读音 ${unit.reading} 后插入`} onClick={() => { setNewAfter(unit.id); setNewReading(''); }}>+</button>
        <button aria-label={`拆分读音 ${unit.reading}`} disabled={firstSplitOffset(unit.reading) === null} onClick={() => split(unit, firstSplitOffset(unit.reading)!, unit.reading)}>拆</button>
        <button aria-label={`合并前一读音 ${unit.reading}`} disabled={index === 0} onClick={() => merge(unit, word.rubyUnits[index - 1], unit.reading)}>合</button>
        <button aria-label={`删除读音 ${unit.reading}`} onClick={() => apply({ type: 'delete-ruby', lineId, wordId: word.id, rubyId: unit.id })}>×</button>
      </div>
      <TimePair begin={unit.beginUs} end={unit.endUs} label={`读音 ${unit.reading}`} onCommit={(beginUs, endUs) => apply({ type: 'set-ruby-time', lineId, wordId: word.id, rubyId: unit.id, beginUs, endUs })} />
    </div>)}</div>}
    {newAfter !== undefined && <div className={styles.rubyAdd}><input ref={newInput} aria-label={`新增读音 ${word.text}`} value={newReading} onChange={(event) => setNewReading(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); add(); } if (event.key === 'Escape') setNewAfter(undefined); }} /><button onClick={add} disabled={!newReading}>添加</button><button onClick={() => setNewAfter(undefined)}>取消</button></div>}
    <div className={styles.rubyTools}><button onClick={() => { setNewAfter(word.rubyUnits.at(-1)?.id ?? null); setNewReading(''); }}>加读音</button>{word.rubyUnits.length > 0 && <><button onClick={splitMora}>按音拍拆分</button><button onClick={() => apply({ type: 'redistribute-ruby-time', lineId, wordId: word.id })}>重分配读音时间</button></>}</div>
    {error && <small role="alert">{error}</small>}
  </div>;
}
