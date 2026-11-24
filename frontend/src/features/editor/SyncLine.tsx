import { useSyncStyle } from '../../adapters/sync-style';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { LyricLine, LyricWord } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { SyncCursor } from '../../domain/sync-editing';
import { emptyBeatCount, type ProjectEditing } from '../../domain/project-editing';
import type { EditorSelection } from './editing-actions';
import type { SyncProgress } from './sync-progress';
import { InlineDraft } from './InlineAdd';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

type DraftController = { id: string | null; open: (id: string) => void; close: () => void; commit: RefObject<(() => boolean) | null> };
function SyncText({ id, text, label, active, draft, commit }: { id: string; text: string; label: string; active: boolean; draft: DraftController; commit: (text: string) => boolean }) {
  useTranslation();
  const [value, setValue] = useState(text), [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null), composing = useRef(false), finished = useRef(false);
  const host = useRef<HTMLSpanElement>(null);
  const editing = draft.id === id;
  const close = () => { finished.current = true; draft.close(); requestAnimationFrame(() => host.current?.closest<HTMLElement>('[data-ruby-id], [data-word-id]')?.focus({ preventScroll: true })); };
  const submit = () => {
    if (finished.current) return true;
    if (composing.current) return false;
    if (input.current!.value !== text && !commit(input.current!.value)) { setError(true); return false; }
    close(); return true;
  };
  useLayoutEffect(() => {
    if (!editing) return;
    setValue(text); setError(false); finished.current = false;
    draft.commit.current = submit;
    input.current?.focus({ preventScroll: true }); input.current?.select();
    return () => { draft.commit.current = null; };
  }, [editing]);
  return <span ref={host} className={styles.syncText} data-sync-active={active || undefined} onDoubleClick={event => { event.stopPropagation(); draft.open(id); }}>
    {editing ? <><input ref={input} aria-label={label} aria-invalid={error} value={value} style={{ width: `${Math.max(2, Array.from(value).length)}ch` }} onChange={event => { setValue(event.target.value); setError(false); }}
      onClick={event => event.stopPropagation()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; if (event.currentTarget !== document.activeElement) submit(); }}
      onBlur={() => { submit(); }} onKeyDown={event => { event.stopPropagation(); if (event.nativeEvent.isComposing || composing.current) return;
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { event.preventDefault(); close(); }
      }}/>{error && <small role="alert">{t('sync.editFailed')}</small>}</> : <span>{text || '\u00a0'}</span>}
  </span>;
}

export function SyncLine({ line, ordinal, gutterDigits, editing, selection, cursor, progress, draft, apply, selectLine, selectWord, selectRuby, renderWordDraft, addWord, rubyDraft, closeRubyDraft, placeholder, karaoke, presentation = 'sync' }: {
  presentation?: 'edit' | 'sync' | 'karaoke';
  karaoke?: { add: ReactNode; before: ReactNode; gap: (leftId: string, rightId: string, wordId?: string) => ReactNode };
  line: LyricLine; ordinal?: number; gutterDigits: number; editing: ProjectEditing; selection: EditorSelection | null; cursor: SyncCursor | null; progress: SyncProgress; draft: DraftController;
  apply: (command: LyricCommand) => boolean; selectLine: (shift: boolean, toggle: boolean) => void;
  selectWord: (word: LyricWord, shift?: boolean, toggle?: boolean) => void; selectRuby: (word: LyricWord, id: string, shift?: boolean, toggle?: boolean) => void;
  renderWordDraft: (afterId: string | null) => ReactNode; addWord: () => void;
  rubyDraft: { wordId: string; serial: number; afterRubyId?: string | null } | null; closeRubyDraft: () => void;
  placeholder: (kind: 'line' | 'word' | 'ruby', id: string) => boolean;
}) {
  useTranslation();
  const [syncStyle] = useSyncStyle();
  const sug = syncStyle === 'sug';
  const units = line.words.flatMap<{id:string;beginMs:number|null;endMs:number|null;kind:'word'|'ruby'}>(word => word.rubyUnits.length ? word.rubyUnits.filter(unit => unit.reading.trim()).map(unit => ({...unit, kind:'ruby' as const})) : word.text.trim() ? [{...word,kind:'word' as const}] : []);
  const stopAt = (index: number) => editing.syncStops[units[index].id]?.stop ?? index === units.length - 1;
  const ignored = presentation !== 'edit' && editing.ignoredSyncLineIds.includes(line.id);
  const activeId = presentation !== 'edit' && !ignored && !progress.completed && cursor?.lineId === line.id ? cursor.rubyUnitId ?? cursor.wordId : null;
  const selected = (kind: EditorSelection['kind'], id: string) => selection?.kind === kind && selection.ids.includes(id);
  const chooseKey = (event: React.KeyboardEvent, choose: () => void, id?: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'F2' && id) { event.preventDefault(); draft.open(id); }
    if (event.key === 'Enter') { event.preventDefault(); choose(); }
  };
  const markers = (id: string, kind: 'word' | 'ruby', participates: boolean, choose: () => void) => {
    if (presentation === 'edit' || !participates) return null;
    const index = units.findIndex(unit => unit.id === id), unit = units[index];
    const shared = index > 0 && (!sug || !stopAt(index - 1));
    const left = shared && units[index - 1].endMs !== null, right = unit.beginMs !== null;
    const filled = shared ? left && right ? 'full' : left ? 'left' : right ? 'right' : 'none' : right ? 'full' : 'none';
    const stop = stopAt(index);
    return <div className={`${styles.syncMarkers} ${sug ? styles.sugMarkers : ''}`}>
      <button data-role="inline" className={styles.syncDot} tabIndex={-1} aria-label={t('sync.unit')} data-sync-marker="dot" data-current={activeId === id && (sug ? !progress.started : progress.consumed === 0) || undefined}
        onClick={event => { event.stopPropagation(); choose(); }}><Icon name={sug ? 'sync-triangle' : 'sync-dot'} filled={filled} size={16}/></button>
      <span className={styles.syncBeats}>{Array.from({ length: emptyBeatCount(editing, id) }, (_, beat) => <button key={beat} data-role="inline" className={styles.syncBeat} data-beat-owner={id} data-beat-kind={kind} data-sync-marker="beat"
        data-current={activeId === id && (sug ? progress.started && progress.consumed === beat : progress.consumed === beat + 1) || undefined} data-passed={activeId === id && progress.consumed > beat + (sug ? 0 : 1) || undefined}
        aria-label={t(sug ? 'sync.innerBeat' : 'sync.trailingBeat',{number:beat+1})} onClick={event => event.stopPropagation()}><Icon name="sync-beat" size={16}/></button>)}</span>
      {sug && <button data-role="inline" className={styles.syncStop} aria-label={t('sync.stop')} aria-pressed={stop} data-sync-marker="stop" data-stop-owner={id} data-stop-kind={kind} data-current={activeId === id && progress.started && progress.consumed === emptyBeatCount(editing,id) && stop || undefined}
        onClick={event => { event.stopPropagation(); apply({type:'set-sync-stop',id,kind,stop:!stop}); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); apply({type:'set-sync-stop',id,kind,stop:!stop}); }}>
        {stop && <Icon name="sync-dot" filled={unit.endMs !== null ? 'full' : 'none'} size={16}/>}</button>}
    </div>;
  };
  return <section className={styles.syncLine} style={{ '--gutter-digits': gutterDigits } as CSSProperties} data-line-id={line.id} data-presentation={presentation} data-karaoke={Boolean(karaoke)||undefined} data-background={Boolean(line.backgroundOf) || undefined} data-ignored-sync={ignored || undefined}
    data-selected={selected('lines', line.id) || undefined} data-drag-placeholder={placeholder('line', line.backgroundOf ?? line.id) ? '' : undefined} tabIndex={0} aria-label={t('sync.lineLabel',{text:line.words.map(word => word.text).join('') || t('sync.emptyLine')})}
    onKeyDown={event => chooseKey(event, () => selectLine(event.shiftKey, event.ctrlKey || event.metaKey))}
    onClick={event => { if (!(event.target as Element).closest('[data-word-id],button,input')) selectLine(event.shiftKey, event.ctrlKey || event.metaKey); }}>
    <div className={styles.syncLineNumber}>{karaoke?.add}<span className={styles.syncOrdinal}>L{ordinal}</span>{line.backgroundOf && <span>{t('outline.background')}</span>}{ignored && <span tabIndex={0} data-tooltip={t('sync.skipLine')} aria-label={t('sync.skipLine')}><Icon name="skip"/></span>}</div>
    <div className={styles.syncWords}>{karaoke && <div className={styles.karaokeBodySlot}><div className={styles.syncBody}>{karaoke.before}</div></div>}{renderWordDraft(null)}{line.words.map((word, wordIndex) => {
      const hasRuby = word.rubyUnits.length > 0;
      const hasDraft = rubyDraft?.wordId === word.id;
      const rubySlot = hasDraft && <div className={styles.syncRubyDraft} style={{ gridColumn: rubyDraft.afterRubyId == null ? 1 : word.rubyUnits.findIndex(r => r.id === rubyDraft.afterRubyId) + 2 }} key={`new-${rubyDraft.serial}`}><InlineDraft label={t('sync.newReading',{text:word.text})} close={closeRubyDraft} commit={reading => {
        if (!reading.trim()) return true;
        const id = crypto.randomUUID();
        if (!apply({ type: 'insert-ruby', lineId: line.id, wordId: word.id, afterRubyId: rubyDraft.afterRubyId ?? null, rubyId: id, reading })) return false;
        requestAnimationFrame(() => { selectRuby(word, id); document.querySelector<HTMLElement>(`main [data-ruby-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); });
        return true;
      }} /></div>;
      return <Fragment key={word.id}><div data-word-id={word.id} tabIndex={0} className={styles.syncWord} data-selected={selected('words', word.id) || undefined}
        data-drag-placeholder={placeholder('word', word.id) ? '' : undefined} style={{ gridTemplateColumns: `repeat(${Math.max(1, (karaoke ? word.rubyUnits.length*2-1 : word.rubyUnits.length) + Number(hasDraft))}, minmax(0, max-content))` } as CSSProperties}
        onClick={event => { if (!(event.target as Element).closest('[data-ruby-id],button,input')) { event.stopPropagation(); selectWord(word, event.shiftKey, event.ctrlKey || event.metaKey); } }}
        onFocus={event => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) selectWord(word); }}
        onDoubleClick={event => { if (!(event.target as Element).closest('[data-ruby-id],button,input')) { event.stopPropagation(); draft.open(word.id); } }}
        onKeyDown={event => chooseKey(event, () => selectWord(word, event.shiftKey, event.ctrlKey || event.metaKey), word.id)}>
        {hasDraft && rubyDraft.afterRubyId == null && rubySlot}
        {hasRuby && word.rubyUnits.map((unit, index) => <Fragment key={unit.id}><div className={styles.syncRubyColumn} style={{ gridColumn: index * (karaoke ? 2 : 1) + 1 + Number(hasDraft && (rubyDraft.afterRubyId == null || word.rubyUnits.findIndex(r => r.id === rubyDraft.afterRubyId) < index)) } as CSSProperties}>
          <div data-ruby-id={unit.id} tabIndex={0} className={styles.syncRuby} data-selected={selected('ruby', unit.id) || undefined} data-drag-placeholder={placeholder('ruby', unit.id) ? '' : undefined}
            onClick={event => { event.stopPropagation(); selectRuby(word, unit.id, event.shiftKey, event.ctrlKey || event.metaKey); }}
            onFocus={event => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) selectRuby(word, unit.id); }}
            onDoubleClick={event => { event.stopPropagation(); draft.open(unit.id); }}
            onKeyDown={event => chooseKey(event, () => selectRuby(word, unit.id, event.shiftKey, event.ctrlKey || event.metaKey), unit.id)}>
            <SyncText id={unit.id} text={unit.reading} label={t('sync.readingLabel',{text:word.text})} active={activeId === unit.id} draft={draft} commit={reading => apply({ type: 'edit-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id, reading })}/>
          </div>
          {markers(unit.id, 'ruby', Boolean(unit.reading.trim()), () => selectRuby(word, unit.id))}
        </div>{karaoke && word.rubyUnits[index+1] && <div className={styles.karaokeRubySlot} style={{gridRow:1,gridColumn:index*2+2}}>{karaoke.gap(unit.id, word.rubyUnits[index+1].id, word.id)}</div>}{hasDraft && rubyDraft.afterRubyId === unit.id && rubySlot}</Fragment>)}
        <div className={styles.syncBody}>
          <SyncText id={word.id} text={word.text} label={t('sync.wordLabel',{text:word.text})} active={!hasRuby && activeId === word.id} draft={draft} commit={text => apply({ type: 'edit-word', lineId: line.id, wordId: word.id, text })}/>
        </div>
        {!hasRuby && markers(word.id, 'word', Boolean(word.text.trim()), () => selectWord(word))}
      </div>{karaoke && line.words[wordIndex+1] && <div className={styles.karaokeBodySlot}><div className={styles.syncBody}>{karaoke.gap(word.id, line.words[wordIndex+1].id)}</div></div>}{renderWordDraft(word.id)}</Fragment>;
    })}<div className={styles.syncAddWord}><button data-role="primary" className="icon-button" title={t('sync.addWord')} aria-label={t('sync.addWord')} onClick={event => { event.stopPropagation(); addWord(); }}><Icon name="add"/></button></div></div>
  </section>;
}

const t=i18n.t.bind(i18n);
