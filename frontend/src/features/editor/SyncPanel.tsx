import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { syncIndex, syncUnits, type SyncAction, type SyncMode, type SyncCursor } from '../../domain/sync-editing';
import { visibleLineOrdinals } from '../../adapters/output-validation';
import type { TransportHandle } from '../MediaTransport';
import styles from './semantic-editor.module.css';

type KeyAction = SyncAction | 'previous' | 'following' | 'previousLine' | 'followingLine';
const defaults: Record<KeyAction, string> = { start: 'KeyS', next: 'KeyD', end: 'KeyF', previous: 'ArrowLeft', following: 'ArrowRight', previousLine: 'ArrowUp', followingLine: 'ArrowDown' };
const labels: Record<KeyAction, string> = { start: '起始轴', next: '连续轴', end: '结束轴', previous: '上一单元', following: '下一单元', previousLine: '上一行', followingLine: '下一行' };
type Props = { document: LyricDocument; cursor: SyncCursor | null; apply: (command: LyricCommand) => boolean; transport?: RefObject<TransportHandle | null>; onCursor: (cursor: SyncCursor) => void };

function initialBindings(): Record<KeyAction, string> {
  const stored = localStorage.getItem('lazulite-sync-keys');
  if (!stored) return defaults;
  try {
    const value = JSON.parse(stored) as Record<KeyAction, string>;
    return Object.keys(defaults).every((key) => typeof value[key as KeyAction] === 'string') && new Set(Object.values(value)).size === Object.keys(defaults).length ? value : defaults;
  } catch { return defaults; }
}

export function SyncPanel({ document, cursor, apply, transport, onCursor }: Props) {
  const units = useMemo(() => syncUnits(document), [document]);
  const [mode, setMode] = useState<SyncMode>('continuous');
  const [completed, setCompleted] = useState(false);
  const [keys, setKeys] = useState(initialBindings);
  const [offsetMs, setOffsetMs] = useState(0);
  const [emptyBeats, setEmptyBeats] = useState(0);
  const [error, setError] = useState('');
  const index = syncIndex(units, cursor);
  const active = index >= 0 ? units[index] : null;
  const line = document.lines.find((item) => item.id === active?.lineId);
  const word = line?.words.find((item) => item.id === active?.wordId);
  const ruby = word?.rubyUnits.find((item) => item.id === active?.rubyUnitId);
  const beginUs = ruby ? ruby.beginUs : word?.beginUs ?? null;
  const endUs = ruby ? ruby.endUs : word?.endUs ?? null;
  useEffect(() => { setEmptyBeats(0); setCompleted(false); setError(''); }, [cursor?.lineId, cursor?.wordId, cursor?.rubyUnitId]);
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
    const timeUs = Math.max(0, clock.getPositionUs() + Math.round(offsetMs * 1_000));
    if (action === 'next' && !active.rubyUnitId && word && emptyBeats < word.emptyBeat) { setEmptyBeats((value) => value + 1); return; }
    if (apply({ type: 'sync-stamp', cursor: active, action, timeUs, mode })) {
      setError('');
      if (action !== 'start') {
        if (mode === 'line' && lineIndex === lineUnits.length - 1) setCompleted(true);
        else moveTo(Math.min(units.length - 1, index + 1));
      }
    }
  };
  const setBinding = (action: KeyAction, code: string) => {
    if (Object.entries(keys).some(([key, value]) => key !== action && value === code)) { setError(`按键 ${code} 已分配，不能重复`); return; }
    const next = { ...keys, [action]: code };
    setKeys(next); localStorage.setItem('lazulite-sync-keys', JSON.stringify(next)); setError('');
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const action = (Object.entries(keys) as Array<[KeyAction, string]>).find(([, code]) => code === event.code)?.[0];
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
    if (beginUs === null || endUs === null) return;
    const start = before ? Math.max(0, beginUs - 600_000) : endUs;
    transport?.current?.audition(start, before ? beginUs : endUs + 600_000);
  };
  return <section className={styles.syncPanel} aria-label="连续打轴">
    <strong>{active ? `L${lineNumber} · 单元 ${lineIndex + 1} / ${lineUnits.length}` : '当前选择不参与打轴'}</strong>
    <span className={styles.syncQuote}>{word?.text}{ruby && <b> → {ruby.reading}</b>}</span>
    <small className={styles.syncTime}>{beginUs === null ? '—' : (beginUs / 1e6).toFixed(3)}–{endUs === null ? '—' : (endUs / 1e6).toFixed(3)} s</small>
    <select aria-label="打轴模式" value={mode} onChange={event => { setMode(event.target.value as SyncMode); setCompleted(false); }}><option value="continuous">连续</option><option value="line">本行</option></select>
    {completed && <small role="status">本行已完成</small>}
    <div className={styles.syncButtons}>
      <button disabled={index <= 0} onClick={() => moveTo(index - 1)}>上一单元</button>
      <button disabled={!units.slice(0, index).some((unit) => unit.lineId !== active?.lineId)} onClick={previousLine}>上一行</button>
      <button disabled={!active || completed} onClick={() => stamp('start')}>起始轴</button>
      <button disabled={!active || completed} onClick={() => stamp('next')}>连续轴</button>
      <button disabled={!active || completed} onClick={() => stamp('end')}>结束轴</button>
      <button disabled={index < 0 || index >= units.length - 1} onClick={() => moveTo(index + 1)}>下一单元</button>
      <button disabled={!units.some((unit, position) => position > index && unit.lineId !== active?.lineId)} onClick={followingLine}>下一行</button>
      <button disabled={beginUs === null} onClick={() => { if (beginUs !== null) transport?.current?.seekUs(beginUs); }}>回听定位</button>
      <button disabled={beginUs === null} onClick={() => audition(true)}>听前段</button>
      <button disabled={endUs === null} onClick={() => audition(false)}>听后段</button>
    </div>
    {word && word.emptyBeat > 0 && !active?.rubyUnitId && <small>空拍 {emptyBeats}/{word.emptyBeat}：连续轴先计数，再落点</small>}
    <label>输入偏移（毫秒） <input type="number" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value))} /></label>
    <button disabled={beginUs === null || !transport?.current} onClick={() => { if (beginUs !== null && transport?.current) setOffsetMs(Math.round((beginUs - transport.current.getPositionUs()) / 1_000)); }}>按当前起点校准</button>
    <details><summary>快捷键速查与设置</summary><div className={styles.syncBindings}>{(Object.keys(defaults) as KeyAction[]).map((action) => <label key={action}>{labels[action]}<input aria-label={`${labels[action]}快捷键`} readOnly value={keys[action]} onKeyDown={(event) => { event.preventDefault(); if (!event.nativeEvent.isComposing && event.code !== 'Escape') setBinding(action, event.code); }} /></label>)}</div></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
