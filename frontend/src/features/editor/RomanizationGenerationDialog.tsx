import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LyricDocument } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { prepareRomanization, proposeRomanization, romanizationGenerationCommand, romanizeReading } from '../../domain/romanization-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function RomanizationGenerationDialog({ document, lineIds, apply, close }: {
  document: LyricDocument; lineIds: string[]; apply: (command: LyricCommand) => boolean; close: () => void;
}) {
  const [source] = useState(document);
  const rows = useMemo(() => proposeRomanization(source, lineIds), [source, lineIds]);
  const [trackId, setTrackId] = useState('');
  const [kind, setKind] = useState<'plain' | 'timed'>('plain');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 80;
  const virtualizer = useVirtualizer({ count: virtualized ? rows.length : 0, getScrollElement: () => scroll.current, estimateSize: () => 400, overscan: 3, getItemKey: index => rows[index].lineId });
  const shown = virtualized ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], item })) : rows.map(row => ({ row, item: null }));
  const track = source.romanizationTracks.find(item => item.id === trackId);
  const ordinals = new Map(source.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1]));
  const targetFor = (lineId: string) => targets[lineId] ?? (track?.contents.some(content => content.lineId === lineId) ? 'skip' : 'append');
  let issue = '';
  try { prepareRomanization(document, source, rows, { trackId: trackId || null, kind, targets, readings, texts, confirmed }); }
  catch (cause) { issue = (cause as Error).message; }
  const submit = () => {
    try { if (apply(romanizationGenerationCommand(document, source, rows, { trackId: trackId || null, kind, targets, readings, texts, confirmed }))) close(); }
    catch (cause) { setMessage((cause as Error).message); }
  };
  return <SettingsDialog title="从 Ruby 生成音译" subtitle={`生成 ${rows.filter(row => targetFor(row.lineId) !== 'skip').length} / ${lineIds.length} 行`} close={close}
    actions={<><button onClick={close}>取消</button><button disabled={Boolean(issue)} onClick={submit}>生成音译</button></>}>
    <div className={styles.rubyGeneration}>
      <div className={styles.rubyGenerationOptions}>
        <label>目标轨道 <select aria-label="目标轨道" value={trackId} onChange={event => { setTrackId(event.target.value); setTargets({}); setMessage(''); }}><option value="">新建 · ja-Latn</option>
          {source.romanizationTracks.filter(track => track.language === 'ja-Latn').map(track => <option key={track.id} value={track.id}>轨道 {source.romanizationTracks.indexOf(track) + 1} · ja-Latn</option>)}
        </select></label>
        <label>输出 <select aria-label="输出" value={kind} onChange={event => setKind(event.target.value as 'plain' | 'timed')}><option value="plain">普通文本</option><option value="timed">按词组定时</option></select></label>
      </div>
      <div ref={scroll} data-proposal-count={rows.length} className={`${styles.rubyGenerationRows} ${virtualized ? styles.rubyGenerationRowsVirtual : ''}`}>
        <div style={virtualized ? { position: 'relative', height: virtualizer.getTotalSize() } : { display: 'grid', gap: 8 }}>
          {shown.map(({ row, item }) => <div key={row.lineId} ref={item ? virtualizer.measureElement : undefined} data-index={item?.index} data-roman-proposal={row.lineId}
            style={item ? { position: 'absolute', width: '100%', transform: `translateY(${item.start}px)` } : undefined} className={styles.rubyGenerationRow}>
            <label>L{ordinals.get(row.lineId)} <select aria-label={`L${ordinals.get(row.lineId)}生成内容`} value={targetFor(row.lineId)} onChange={event => setTargets(current => ({ ...current, [row.lineId]: event.target.value }))}>
              <option value="skip">跳过 · 保留已有</option><option value="append">添加新内容</option>
              {track?.contents.filter(content => content.lineId === row.lineId).map(content => <option key={content.id} value={content.id}>替换 · {content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('')}</option>)}
            </select></label>
            {row.groups.map((group, index) => {
              const reading = readings[group.key] ?? group.reading;
              let converted = ''; let readingIssue = '';
              try { converted = /^\s+$/.test(reading) ? reading : romanizeReading(reading); } catch (cause) { readingIssue = (cause as Error).message; }
              return <div key={group.key} className={styles.romanProposalGroup}>
                <strong>{group.sourceText}</strong>
                <label>读音 <input aria-label={`L${ordinals.get(row.lineId)}词组 ${index + 1}读音`} value={reading} aria-invalid={Boolean(readingIssue)} placeholder="待补假名读音" onChange={event => {
                  setReadings(current => ({ ...current, [group.key]: event.target.value }));
                  setTexts(current => { const next = { ...current }; delete next[group.key]; return next; });
                  setConfirmed(current => new Set([...current].filter(key => key !== group.key)));
                }} /></label>
                <label>音译 <input aria-label={`L${ordinals.get(row.lineId)}词组 ${index + 1}音译`} value={texts[group.key] ?? converted} onChange={event => setTexts(current => ({ ...current, [group.key]: event.target.value }))} /></label>
                {readingIssue && <small>{readingIssue}</small>}
                {kind === 'timed' && <small>{group.beginUs === null ? '未定' : `${group.beginUs / 1e6}s`} – {group.endUs === null ? '未定' : `${group.endUs / 1e6}s`}</small>}
                {group.context && <label><input type="checkbox" checked={confirmed.has(group.key)} onChange={event => setConfirmed(current => { const next = new Set(current); if (event.target.checked) next.add(group.key); else next.delete(group.key); return next; })} />确认跨词读音</label>}
              </div>;
            })}
          </div>)}
        </div>
      </div>
      {kind === 'timed' && rows.some(row => targetFor(row.lineId) !== 'skip' && row.groups.some(group => group.beginUs === null || group.endUs === null)) && <small>词组时间未定，最终导出前需补全；也可选择普通文本。</small>}
      {(message || issue) && <p role="alert">{message || issue}</p>}
    </div>
  </SettingsDialog>;
}
