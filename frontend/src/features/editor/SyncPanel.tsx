import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { DisclosureTrigger } from '../../shared/Disclosure';
import type { SyncProgress } from './sync-progress';
import { useProjectEditing } from './ProjectEditingContext';
import { useSyncStyle } from '../../adapters/sync-style';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { usePreference } from './use-preference';
import { useEffect, useMemo, useRef, useState, useId, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { sugSyncStep, syncIndex, syncUnits, type SyncAction, type SyncMode, type SyncCursor } from '../../domain/sync-editing';
import { matchesBinding, shortcutInput, useShortcuts } from '../shortcuts';
import { visibleLineOrdinals } from '../../adapters/output-validation';
import type { TransportHandle } from '../MediaTransport';
import styles from './semantic-editor.module.css';

type Props = { lineOrder?: string[]; progress: SyncProgress; onProgress: (progress: SyncProgress, cursor?: SyncCursor) => void; preferenceScope?: string; document: LyricDocument; cursor: SyncCursor | null; targetVersion?: number; apply: (command: LyricCommand) => boolean; transport?: RefObject<TransportHandle | null>; onCursor: (cursor: SyncCursor) => void };

export function SyncPanel({ progress, onProgress, document, lineOrder, cursor, targetVersion, apply, transport, onCursor, preferenceScope = 'local:untitled' }: Props) {
  useTranslation();
  const editing = useProjectEditing();
  const [style] = useSyncStyle();
  const [extrasOpen, setExtrasOpen] = useState(false);
  const extrasId = useId();
  const skipped = editing.ignoredSyncLineIds.includes(cursor?.lineId ?? '');
  const [mode, setMode] = usePreference<SyncMode>('studio:sync-mode', 'continuous', (v): v is SyncMode => v === 'continuous' || v === 'line');
  const units = useMemo(() => syncUnits(document, editing, mode === 'continuous' && skipped ? cursor?.lineId : undefined, lineOrder, mode === 'line'), [document, editing, mode, skipped, cursor?.lineId, lineOrder]);
  const { completed, consumed: emptyBeats } = progress;
  const keys = useShortcuts();
  const [offsetMs, setOffsetMs] = usePreference<number>(`studio:sync-offset:${preferenceScope}`, 0, (v): v is number => Number.isSafeInteger(v));
  const [error, setError] = useMessageText('');
  const index = syncIndex(units, cursor);
  const active = index >= 0 ? units[index] : null;
  const line = document.lines.find((item) => item.id === active?.lineId);
  const word = line?.words.find((item) => item.id === active?.wordId);
  const ruby = word?.rubyUnits.find((item) => item.id === active?.rubyUnitId);
  const beginMs = ruby ? ruby.beginMs : word?.beginMs ?? null;
  const endMs = ruby ? ruby.endMs : word?.endMs ?? null;
  useEffect(() => { setError(''); }, [cursor?.lineId, cursor?.wordId, cursor?.rubyUnitId, targetVersion]);
  const beatCount = active ? emptyBeatCount(editing, active.rubyUnitId ?? active.wordId) : 0;
  const effectiveMode = skipped ? 'line' : mode;
  const lineUnits = units.filter(unit => unit.lineId === active?.lineId);
  const lineIndex = syncIndex(lineUnits, active);
  const lineNumber = line ? visibleLineOrdinals(document).get(line.id) : null;
  const moveTo = (at: number) => {
    const next = units[at];
    if (!next) return;
    onProgress({ completed: false, consumed: 0 }); setError(''); onCursor(next);
  };
  const canMoveUnit = (at:number) => !!units[at] && (!skipped || units[at].lineId === active?.lineId);
  const moveUnit = (at:number) => {if(canMoveUnit(at))moveTo(at);};
  const previousLine = () => { const before = units.slice(0, index).reverse().find((unit) => unit.lineId !== active?.lineId); if (before) moveTo(units.findIndex((unit) => unit.lineId === before.lineId)); };
  const followingLine = () => { const at = units.findIndex((unit, position) => position > index && unit.lineId !== active?.lineId); if (at >= 0) moveTo(at); };
  const canStamp = (action: SyncAction) => !!transport && !!active && (action === 'start' || !completed);
  const stamp = (action: SyncAction) => {
    if (!canStamp(action) || !active) return;
    const clock = transport?.current;
    if (!clock) return;
    const timeMs = Math.max(0, clock.getPositionMs() + Math.round(offsetMs));
    if (action !== 'start' && (beginMs === null || !Number.isSafeInteger(beginMs) || beginMs < 0)) { setError(describeMessage('sync.startFirst')); return; }
    if (action === 'next' && emptyBeats < beatCount) { onProgress({ completed: false, consumed: emptyBeats + 1 }); setError(''); return; }
    if (!apply({ type: 'sync-stamp', cursor: active, action, timeMs, mode: effectiveMode, lineOrder })) return;
    setError('');
    if (action === 'start') { onProgress({ completed: false, consumed: 0, ...(style === 'sug' ? {started:true} : {}) }); return; }
    const next = units[index + 1];
    if (!next || effectiveMode === 'line' && next.lineId !== active.lineId) onProgress({ completed: true, consumed: 0 });
    else moveTo(index + 1);
  };
  const sugStamp = (event: 'pressed' | 'released') => {
    if (!active || !transport?.current || completed) return;
    try {
      const timeMs = Math.max(0, transport.current.getPositionMs() + Math.round(offsetMs));
      const step = sugSyncStep(document, editing, active, progress, event, timeMs);
      if (step.action && !apply({ type: 'sync-stamp', cursor: active, action: step.action, timeMs, mode: effectiveMode, lineOrder })) return;
      setError('');
      if (step.advance) {
        const next = units[index + 1];
        if (!next || effectiveMode === 'line' && next.lineId !== active.lineId) onProgress({ completed: true, consumed: 0 });
        else { onProgress(step.progress, next); onCursor(next); }
      } else onProgress(step.progress);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const heldKey = useRef<string | null>(null);
  const releaseRef = useRef(sugStamp); releaseRef.current = sugStamp;
  useEffect(() => {
    const release = (event: KeyboardEvent) => {
      if (event.code !== heldKey.current) return;
      heldKey.current = null; event.preventDefault(); releaseRef.current('released');
    };
    const cancel = () => { heldKey.current = null; };
    window.addEventListener('keyup', release); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keyup', release); window.removeEventListener('blur', cancel); heldKey.current = null; };
  }, [style, targetVersion]);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (shortcutInput(event.target, event.code)) return;
    const action = (['start', 'next', 'end', 'previous', 'following', 'previousLine', 'followingLine'] as const).find(action => matchesBinding(event, keys[action]));
    if (!action) return;
    if (event.target instanceof Element && event.target.closest('[data-transport]')
      && (!['start', 'next', 'end'].includes(action)
        || (['seekStart', 'seekEnd', 'seekBack', 'seekForward'] as const).some(key => matchesBinding(event, keys[key])))) return;
    event.preventDefault();
    if (action === 'previous') moveUnit(index - 1);
    else if (action === 'following') moveUnit(index + 1);
    else if (action === 'previousLine') previousLine();
    else if (action === 'followingLine') followingLine();
    else if (style === 'sug' && action === 'next') { heldKey.current = event.code; sugStamp('pressed'); }
    else stamp(action);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const audition = (before: boolean) => {
    if (beginMs === null || endMs === null) return;
    const start = before ? Math.max(0, beginMs - 600) : endMs;
    transport?.current?.audition(start, before ? beginMs : endMs + 600);
  };
  return <section className={styles.syncPanel} aria-label={t('sync.title')}>
    {!transport && <p className={styles.syncAudioHint}>{t('sync.noAudio')}</p>}
    <div className={styles.syncMain}>
    <strong>{active ? t('sync.progress',{line:lineNumber,number:lineIndex+1,total:lineUnits.length}) : t('sync.excluded')}</strong>
    <span className={styles.syncQuote}><span>{word?.text}</span>{ruby && <b> → {ruby.reading}</b>}</span>
    <small className={styles.syncTime}>{beginMs === null ? '—' : (beginMs / 1e3).toFixed(3)}–{endMs === null ? '—' : (endMs / 1e3).toFixed(3)} s</small>
    <Select aria-label={t('sync.mode')} disabled={skipped} value={effectiveMode} onChange={event => { setMode(event.target.value as SyncMode); onProgress({ completed: false, consumed: 0 }); }}><option value="continuous">{t('sync.continuous')}</option><option value="line">{t('sync.line')}</option></Select>
    {offsetMs !== 0 && <small>{t('sync.offset')} {offsetMs} ms <button data-role="secondary" onClick={() => setOffsetMs(0)}>{t('sync.reset')}</button></small>}
    {emptyBeats > 0 && <small>{t(style === 'sug' ? 'editor.innerBeats' : 'sync.countdown')} {emptyBeats}/{beatCount}</small>}
    <div className={styles.syncButtons}>
      <button data-role="secondary" disabled={!canMoveUnit(index - 1)} onClick={() => moveUnit(index - 1)}>{t('sync.previousUnit')}</button>
      <button data-role="secondary" disabled={!units.slice(0, index).some((unit) => unit.lineId !== active?.lineId)} onClick={previousLine}>{t('sync.previousLine')}</button>
      {style === 'sug' && <button data-role="primary" disabled={!transport || !active || completed} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); sugStamp('pressed'); }} onPointerUp={() => sugStamp('released')} onPointerCancel={() => { heldKey.current = null; }} onKeyDown={event => { if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); event.stopPropagation(); sugStamp('pressed'); } }} onKeyUp={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); sugStamp('released'); } }}>{t('sync.singleKey')}</button>}
      <button data-role="secondary" disabled={!canStamp('start')} onClick={() => stamp('start')}>{t('sync.start')}</button>
      <button data-role="secondary" disabled={!canStamp('next')} onClick={() => stamp('next')}>{t('sync.step')}</button>
      <button data-role="secondary" disabled={!canStamp('end')} onClick={() => stamp('end')}>{t('sync.end')}</button>
      <button data-role="secondary" disabled={index < 0 || !canMoveUnit(index + 1)} onClick={() => moveUnit(index + 1)}>{t('sync.nextUnit')}</button>
      <button data-role="secondary" disabled={!units.some((unit, position) => position > index && unit.lineId !== active?.lineId)} onClick={followingLine}>{t('sync.nextLine')}</button>
    </div>
    <DisclosureTrigger open={extrasOpen} controls={extrasId} toggle={() => setExtrasOpen(open => !open)}>{t('sync.audition')}</DisclosureTrigger>
    </div>
    {extrasOpen && <div className={styles.syncExtras} id={extrasId}>
      <button data-role="secondary" disabled={!transport || beginMs === null} onClick={() => { if (beginMs !== null) transport?.current?.seekMs(beginMs); }}>{t('sync.auditionPosition')}</button>
      <button data-role="secondary" disabled={!transport || beginMs === null} onClick={() => audition(true)}>{t('sync.before')}</button>
      <button data-role="secondary" disabled={!transport || endMs === null} onClick={() => audition(false)}>{t('sync.after')}</button>
    {beatCount > 0 && <small>{t(style === 'sug' ? 'editor.innerBeats' : 'sync.countdown')} {emptyBeats}/{beatCount}{t(style === 'sug' ? 'sync.innerBeatHelp' : 'sync.countdownHelp')}</small>}
    <label>{t('sync.offsetMs')}<input type="number" value={offsetMs} onChange={(event) => setOffsetMs(Math.round(Number(event.target.value)))} /></label>
    <button data-role="secondary" disabled={beginMs === null || !transport?.current} onClick={() => { if (beginMs !== null && transport?.current) setOffsetMs(Math.round((beginMs - transport.current.getPositionMs()) )); }}>{t('sync.calibrate')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

const t=i18n.t.bind(i18n);
