import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { syncIndex, syncUnits, type SyncAction, type SyncMode, type SyncCursor } from '../../domain/sync-editing';
import { matchesBinding, shortcutInput, useShortcuts } from '../shortcuts';
import { visibleLineOrdinals } from '../../adapters/output-validation';
import type { TransportHandle } from '../MediaTransport';
import styles from './semantic-editor.module.css';

type Props = { document: LyricDocument; cursor: SyncCursor | null; targetVersion?: number; apply: (command: LyricCommand) => boolean; transport?: RefObject<TransportHandle | null>; onCursor: (cursor: SyncCursor) => void };

export function SyncPanel({ document, cursor, targetVersion, apply, transport, onCursor }: Props) {
  const units = useMemo(() => syncUnits(document), [document]);
  const [mode, setMode] = useState<SyncMode>('continuous');
  const [completed, setCompleted] = useState(false);
  const keys = useShortcuts();
  const [offsetMs, setOffsetMs] = useState(0);
  const [emptyBeats, setEmptyBeats] = useState(0);
  const [error, setError] = useState('');
  const index = syncIndex(units, cursor);
  const active = index >= 0 ? units[index] : null;
  const line = document.lines.find((item) => item.id === active?.lineId);
  const word = line?.words.find((item) => item.id === active?.wordId);
  const ruby = word?.rubyUnits.find((item) => item.id === active?.rubyUnitId);
  const beginMs = ruby ? ruby.beginMs : word?.beginMs ?? null;
  const endMs = ruby ? ruby.endMs : word?.endMs ?? null;
  useEffect(() => { setEmptyBeats(0); setCompleted(false); setError(''); }, [cursor?.lineId, cursor?.wordId, cursor?.rubyUnitId, targetVersion]);
  const lineUnits = units.filter(unit => unit.lineId === active?.lineId);
  const lineIndex = syncIndex(lineUnits, active);
  const lineNumber = line ? visibleLineOrdinals(document).get(line.id) : null;
  const moveTo = (at: number) => {
    const next = units[at];
    if (!next) return;
    setCompleted(false); setEmptyBeats(0); setError(''); onCursor(next);
  };
  const previousLine = () => { const before = units.slice(0, index).reverse().find((unit) => unit.lineId !== active?.lineId); if (before) moveTo(units.findIndex((unit) => unit.lineId === before.lineId)); };
  const followingLine = () => { const at = units.findIndex((unit, position) => position > index && unit.lineId !== active?.lineId); if (at >= 0) moveTo(at); };
  const stamp = (action: SyncAction) => {
    if (!active || completed) return;
    const clock = transport?.current;
    if (!clock) { setError('请先连接项目音频'); return; }
    const timeMs = Math.max(0, clock.getPositionMs() + Math.round(offsetMs));
    if (action === 'next' && !active.rubyUnitId && word && emptyBeats < word.emptyBeat) { setEmptyBeats((value) => value + 1); return; }
    if (apply({ type: 'sync-stamp', cursor: active, action, timeMs, mode })) {
      setError('');
      if (action !== 'start') {
        if (mode === 'line' && lineIndex === lineUnits.length - 1) setCompleted(true);
        else moveTo(Math.min(units.length - 1, index + 1));
      }
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (shortcutInput(event.target) || event.target instanceof Element && event.target.closest('[data-transport]')) return;
      const action = (['start', 'next', 'end', 'previous', 'following', 'previousLine', 'followingLine'] as const).find(action => matchesBinding(event, keys[action]));
      if (!action) return;
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
  return <section className={styles.syncPanel} aria-label="连续打轴">
    <strong>{active ? `L${lineNumber} · 单元 ${lineIndex + 1} / ${lineUnits.length}` : '当前选择不参与打轴'}</strong>
    <span className={styles.syncQuote}><span>{word?.text}</span>{ruby && <b> → {ruby.reading}</b>}</span>
    <small className={styles.syncTime}>{beginMs === null ? '—' : (beginMs / 1e3).toFixed(3)}–{endMs === null ? '—' : (endMs / 1e3).toFixed(3)} s</small>
    <select aria-label="打轴模式" value={mode} onChange={event => { setMode(event.target.value as SyncMode); setCompleted(false); }}><option value="continuous">连续</option><option value="line">本行</option></select>
    {emptyBeats > 0 && <small>空拍 {emptyBeats}/{word?.emptyBeat}</small>}
    {completed && <small role="status">本行已完成</small>}
    <div className={styles.syncButtons}>
      <button disabled={index <= 0} onClick={() => moveTo(index - 1)}>上一单元</button>
      <button disabled={!units.slice(0, index).some((unit) => unit.lineId !== active?.lineId)} onClick={previousLine}>上一行</button>
      <button disabled={!active || completed} onClick={() => stamp('start')}>起始轴</button>
      <button disabled={!active || completed} onClick={() => stamp('next')}>连续轴</button>
      <button disabled={!active || completed} onClick={() => stamp('end')}>结束轴</button>
      <button disabled={index < 0 || index >= units.length - 1} onClick={() => moveTo(index + 1)}>下一单元</button>
      <button disabled={!units.some((unit, position) => position > index && unit.lineId !== active?.lineId)} onClick={followingLine}>下一行</button>
    </div>
    <details className={styles.syncExtras}><summary>回听与校准</summary><div>
      <button disabled={beginMs === null} onClick={() => { if (beginMs !== null) transport?.current?.seekMs(beginMs); }}>回听定位</button>
      <button disabled={beginMs === null} onClick={() => audition(true)}>听前段</button>
      <button disabled={endMs === null} onClick={() => audition(false)}>听后段</button>
    {word && word.emptyBeat > 0 && !active?.rubyUnitId && <small>空拍 {emptyBeats}/{word.emptyBeat}：连续轴先计数，再落点</small>}
    <label>输入偏移（毫秒） <input type="number" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value))} /></label>
    <button disabled={beginMs === null || !transport?.current} onClick={() => { if (beginMs !== null && transport?.current) setOffsetMs(Math.round((beginMs - transport.current.getPositionMs()) )); }}>按当前起点校准</button>
    </div></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
