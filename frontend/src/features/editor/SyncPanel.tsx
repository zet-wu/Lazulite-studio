import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { DisclosureTrigger } from '../../shared/Disclosure';
import type { SyncProgress } from './sync-progress';
import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { usePreference } from './use-preference';
import { useEffect, useMemo, useState, useId, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { syncIndex, syncUnits, type SyncAction, type SyncMode, type SyncCursor } from '../../domain/sync-editing';
import { matchesBinding, shortcutInput, useShortcuts } from '../shortcuts';
import { visibleLineOrdinals } from '../../adapters/output-validation';
import type { TransportHandle } from '../MediaTransport';
import styles from './semantic-editor.module.css';

type Props = { progress: SyncProgress; onProgress: (progress: SyncProgress) => void; preferenceScope?: string; document: LyricDocument; cursor: SyncCursor | null; targetVersion?: number; apply: (command: LyricCommand) => boolean; transport?: RefObject<TransportHandle | null>; onCursor: (cursor: SyncCursor) => void };

export function SyncPanel({ progress, onProgress, document, cursor, targetVersion, apply, transport, onCursor, preferenceScope = 'local:untitled' }: Props) {
  useTranslation();
  const editing = useProjectEditing();
  const [extrasOpen, setExtrasOpen] = useState(false);
  const extrasId = useId();
  const background = document.lines.find(line => line.id === cursor?.lineId)?.backgroundOf;
  const units = useMemo(() => syncUnits(document, editing, background ? cursor?.lineId : undefined), [document, editing, background, cursor?.lineId]);
  const [mode, setMode] = usePreference<SyncMode>('studio:sync-mode', 'continuous', (v): v is SyncMode => v === 'continuous' || v === 'line');
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
  const effectiveMode = background ? 'line' : mode;
  const lineUnits = units.filter(unit => unit.lineId === active?.lineId);
  const lineIndex = syncIndex(lineUnits, active);
  const lineNumber = line ? visibleLineOrdinals(document).get(line.id) : null;
  const moveTo = (at: number) => {
    const next = units[at];
    if (!next) return;
    onProgress({ completed: false, consumed: 0 }); setError(''); onCursor(next);
  };
  const previousLine = () => { const before = units.slice(0, index).reverse().find((unit) => unit.lineId !== active?.lineId); if (before) moveTo(units.findIndex((unit) => unit.lineId === before.lineId)); };
  const followingLine = () => { const at = units.findIndex((unit, position) => position > index && unit.lineId !== active?.lineId); if (at >= 0) moveTo(at); };
  const stamp = (action: SyncAction) => {
    if (!active || completed && action !== 'start') return;
    const clock = transport?.current;
    if (!clock) { setError(describeMessage('sync.connectAudio')); return; }
    const timeMs = Math.max(0, clock.getPositionMs() + Math.round(offsetMs));
    if (action !== 'start' && (beginMs === null || !Number.isSafeInteger(beginMs) || beginMs < 0)) { setError(describeMessage('sync.startFirst')); return; }
    if (action === 'next' && emptyBeats < beatCount) { onProgress({ completed: false, consumed: emptyBeats + 1 }); setError(''); return; }
    if (!apply({ type: 'sync-stamp', cursor: active, action, timeMs, mode: effectiveMode })) return;
    setError('');
    if (action === 'start') { onProgress({ completed: false, consumed: 0 }); return; }
    const next = units[index + 1];
    if (!next || effectiveMode === 'line' && next.lineId !== active.lineId) onProgress({ completed: true, consumed: 0 });
    else moveTo(index + 1);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (shortcutInput(event.target, event.code)) return;
      const action = (['start', 'next', 'end', 'previous', 'following', 'previousLine', 'followingLine'] as const).find(action => matchesBinding(event, keys[action]));
      if (!action) return;
      if (event.target instanceof Element && event.target.closest('[data-transport]')
        && (!['start', 'next', 'end'].includes(action)
          || (['seekStart', 'seekEnd', 'seekBack', 'seekForward'] as const).some(key => matchesBinding(event, keys[key])))) return;
      event.preventDefault();
      if (action === 'previous') moveTo(index - 1);
      else if (action === 'following') moveTo(index + 1);
      else if (action === 'previousLine') previousLine();
      else if (action === 'followingLine') followingLine();
      else stamp(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
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
    <Select aria-label={t('sync.mode')} disabled={Boolean(background)} value={effectiveMode} onChange={event => { setMode(event.target.value as SyncMode); onProgress({ completed: false, consumed: 0 }); }}><option value="continuous">{t('sync.continuous')}</option><option value="line">{t('sync.line')}</option></Select>
    {background && <span>{t('sync.backgroundLine')}</span>}
    {offsetMs !== 0 && <small>{t('sync.offset')}{offsetMs} ms <button data-role="secondary" onClick={() => setOffsetMs(0)}>{t('sync.reset')}</button></small>}
    {emptyBeats > 0 && <small>{t('sync.countdown')}{emptyBeats}/{beatCount}</small>}
    <div className={styles.syncButtons}>
      <button data-role="secondary" disabled={index <= 0} onClick={() => moveTo(index - 1)}>{t('sync.previousUnit')}</button>
      <button data-role="secondary" disabled={!units.slice(0, index).some((unit) => unit.lineId !== active?.lineId)} onClick={previousLine}>{t('sync.previousLine')}</button>
      <button data-role="secondary" disabled={!transport || !active} onClick={() => stamp('start')}>{t('sync.start')}</button>
      <button data-role="secondary" disabled={!transport || !active || completed} onClick={() => stamp('next')}>{t('sync.step')}</button>
      <button data-role="secondary" disabled={!transport || !active || completed} onClick={() => stamp('end')}>{t('sync.end')}</button>
      <button data-role="secondary" disabled={index < 0 || index >= units.length - 1} onClick={() => moveTo(index + 1)}>{t('sync.nextUnit')}</button>
      <button data-role="secondary" disabled={!units.some((unit, position) => position > index && unit.lineId !== active?.lineId)} onClick={followingLine}>{t('sync.nextLine')}</button>
    </div>
    <DisclosureTrigger open={extrasOpen} controls={extrasId} toggle={() => setExtrasOpen(open => !open)}>{t('sync.audition')}</DisclosureTrigger>
    </div>
    {extrasOpen && <div className={styles.syncExtras} id={extrasId}>
      <button data-role="secondary" disabled={!transport || beginMs === null} onClick={() => { if (beginMs !== null) transport?.current?.seekMs(beginMs); }}>{t('sync.auditionPosition')}</button>
      <button data-role="secondary" disabled={!transport || beginMs === null} onClick={() => audition(true)}>{t('sync.before')}</button>
      <button data-role="secondary" disabled={!transport || endMs === null} onClick={() => audition(false)}>{t('sync.after')}</button>
    {beatCount > 0 && <small>{t('sync.countdown')}{emptyBeats}/{beatCount}{t('sync.countdownHelp')}</small>}
    <label>{t('sync.offsetMs')}<input type="number" value={offsetMs} onChange={(event) => setOffsetMs(Math.round(Number(event.target.value)))} /></label>
    <button data-role="secondary" disabled={beginMs === null || !transport?.current} onClick={() => { if (beginMs !== null && transport?.current) setOffsetMs(Math.round((beginMs - transport.current.getPositionMs()) )); }}>{t('sync.calibrate')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

const t=i18n.t.bind(i18n);
