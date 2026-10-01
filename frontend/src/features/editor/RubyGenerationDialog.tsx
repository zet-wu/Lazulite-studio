import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LyricCommand } from '../../domain/lyric-commands';
import { type LyricDocument } from '../../domain/lyric-document';
import { defaultRubySkips, proposeRuby, rubyGenerationCommand, rubySourceRows, type RubyOutput, type RubyProposalRow } from '../../domain/ruby-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

const time = (value: number | null) => value === null ? '未定' : `${(value / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
const firstContents = (document: LyricDocument, trackId: string, lineIds: string[], preferred?: string) => {
  const contents = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  if (preferred && contents.some((content) => content.id === preferred)) return [preferred];
  const seen = new Set<string>();
  return contents.filter((content) => { if (seen.has(content.lineId)) return false; seen.add(content.lineId); return true; }).map((content) => content.id);
};

function RubyProposalRows({ rows, renderRow }: { rows: RubyProposalRow[]; renderRow: (row: RubyProposalRow) => ReactNode }) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 80;
  const rowKey = useCallback((index: number) => rows[index].key, [rows]);
  const virtualizer = useVirtualizer({ count: virtualized ? rows.length : 0, getScrollElement: () => rowsRef.current,
    estimateSize: () => 180, overscan: 6, gap: 7, getItemKey: rowKey });
  const displayed = virtualized ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], item })) : rows.map(row => ({ row, item: null }));
  return <div ref={rowsRef} data-proposal-count={rows.length} className={`${styles.rubyGenerationRows} ${virtualized ? styles.rubyGenerationRowsVirtual : ''}`}>
    <div style={virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : { display: 'grid', gap: 7 }}>
      {displayed.map(({ row, item }) => <div key={row.key} data-index={item?.index} ref={item ? virtualizer.measureElement : undefined}
        style={item ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` } : undefined}>
        {renderRow(row)}
      </div>)}
    </div>
  </div>;
}

export function RubyGenerationDialog({ document, lineIds, initialTrackId, initialContentId, apply, close }: {
  document: LyricDocument; lineIds: string[]; initialTrackId?: string; initialContentId?: string;
  apply: (command: LyricCommand) => boolean; close: () => void;
}) {
  const [sourceDocument, setSourceDocument] = useState(document);
  const tracks = sourceDocument.romanizationTracks.filter((track) => track.contents.some((content) => lineIds.includes(content.lineId)));
  const [trackId, setTrackId] = useState(initialTrackId ?? tracks[0]?.id ?? '');
  const [contentIds, setContentIds] = useState(() => firstContents(document, initialTrackId ?? tracks[0]?.id ?? '', lineIds, initialContentId));
  const [output, setOutput] = useState<RubyOutput>('hiragana');
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [skipOverrides, setSkipOverrides] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const stale = document !== sourceDocument;
  const contents = tracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  const sourceRows = useMemo(() => contentIds.length && trackId ? rubySourceRows(sourceDocument, trackId, contentIds) : [], [sourceDocument, trackId, contentIds]);
  const rows = useMemo(() => proposeRuby(sourceRows, output, assignments), [sourceRows, output, assignments]);
  const defaultSkipped = useMemo(() => defaultRubySkips(sourceDocument, rows, output, readings), [sourceDocument, rows, output, readings]);
  const skipped = new Set(rows.filter(row => Object.hasOwn(skipOverrides, row.key) ? skipOverrides[row.key] : defaultSkipped.has(row.key)).map(row => row.key));
  const allSkipped = rows.length > 0 && skipped.size === rows.length;
  const chosenWords = new Set(rows.filter((row) => !skipped.has(row.key)).map((row) => row.wordId).filter((id): id is string => Boolean(id)));
  const existingWords = sourceDocument.lines.flatMap((line) => line.words.filter((word) => chosenWords.has(word.id) && word.rubyUnits.length).map((word) => ({ line, word })));
  let preview: ReturnType<typeof rubyGenerationCommand> | null = null;
  let issue = '';
  if (!stale && rows.length && !allSkipped) {
    try { preview = rubyGenerationCommand(sourceDocument, sourceDocument, rows, readings, skipped, overwrite); }
    catch (cause) { issue = cause instanceof Error ? cause.message : '提案尚未就绪'; }
  }
  const resetChoices = () => { setAssignments({}); setReadings({}); setSkipOverrides({}); setOverwrite(new Set()); setMessage(''); };
  const selectTrack = (id: string) => { setTrackId(id); setContentIds(firstContents(sourceDocument, id, lineIds)); resetChoices(); };
  const refresh = () => {
    const available = document.romanizationTracks.filter((track) => track.contents.some((content) => lineIds.includes(content.lineId)));
    const nextTrackId = available.some((track) => track.id === trackId) ? trackId : available[0]?.id ?? '';
    setSourceDocument(document); setTrackId(nextTrackId); setContentIds(firstContents(document, nextTrackId, lineIds)); resetChoices();
  };
  const submit = () => {
    try {
      const result = rubyGenerationCommand(document, sourceDocument, rows, readings, skipped, overwrite);
      if (apply(result)) close();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '生成 注音 失败'); }
  };
  const ordinals = new Map(sourceDocument.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1]));
  const generatedLines = new Set(sourceRows.map(row => row.lineId)).size;
  return <SettingsDialog title="从音译生成 注音" subtitle={lineIds.length === 1 && generatedLines === 1 ? `L${ordinals.get(lineIds[0])}` : `生成 ${generatedLines} / ${lineIds.length} 行`} close={close} actions={<><button onClick={close}>取消</button><button disabled={!preview} onClick={submit}>生成 注音</button></>}>
    <div className={styles.rubyGeneration}>
      {stale ? <p role="alert">文档已变化，旧提案不能应用。<button onClick={refresh}>重新生成提案</button></p> : <>
        <div className={styles.rubyGenerationOptions}><label>音译轨道 <select value={trackId} onChange={(event) => selectTrack(event.target.value)}>{tracks.map((track, index) => <option key={track.id} value={track.id}>轨道 {index + 1} · {track.language ?? '未指定语言'}</option>)}</select></label>
          <label>字符输出 <select value={output} onChange={(event) => { setOutput(event.target.value as RubyOutput); setReadings({}); setSkipOverrides({}); setMessage(''); }}><option value="roman">保持罗马字</option><option value="hiragana">转换为平假名</option><option value="katakana">转换为片假名</option></select></label></div>
        <details className={styles.sourceChoices}><summary>音译内容</summary><fieldset className={styles.rubyGenerationChoices}><legend>选取具体音译内容</legend>{contents.map((content) => {
          const line = sourceDocument.lines.find((item) => item.id === content.lineId)!;
          return <label key={content.id}><input type="checkbox" checked={contentIds.includes(content.id)} onChange={(event) => { setContentIds((ids) => event.target.checked ? [...ids, content.id] : ids.filter((id) => id !== content.id)); resetChoices(); }} />
            L{ordinals.get(line.id)} · {content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}
          </label>;
        })}</fieldset></details>
        <RubyProposalRows rows={rows} renderRow={row => {
          const line = sourceDocument.lines.find((item) => item.id === row.lineId)!;
          const selected = Object.hasOwn(assignments, row.key) ? assignments[row.key] ?? '' : row.defaultWordId ?? '';
          return <div className={styles.rubyGenerationRow}>
            <strong>{row.sourceText || '空单元'}</strong><small>{time(row.beginUs)} – {time(row.endUs)} · L{ordinals.get(line.id)}</small>
            <label>目标词 <select value={selected} disabled={skipped.has(row.key)} onChange={(event) => { const nextWordId = event.target.value || null;
                setSkipOverrides(current => Object.fromEntries(Object.entries(current).filter(([key]) => {
                  const affected = rows.find(item => item.key === key)!;
                  return affected.lineId !== row.lineId || affected.wordId !== row.wordId && affected.wordId !== nextWordId;
                })));
                setAssignments((current) => ({ ...current, [row.key]: nextWordId })); setReadings((current) => { const next = { ...current }; delete next[row.key]; return next; }); }}>
              <option value="">待人工分配</option>{line.words.map((word) => <option key={word.id} value={word.id}>{word.text}{row.candidates.includes(word.id) ? ' · 时间重叠' : ''}</option>)}
            </select></label>
            <label>目标 注音 <input value={readings[row.key] ?? row.reading ?? ''} disabled={skipped.has(row.key)} onChange={(event) => setReadings((current) => ({ ...current, [row.key]: event.target.value }))} /></label>
            <label><input type="checkbox" checked={skipped.has(row.key)} onChange={(event) => setSkipOverrides(current => ({ ...current, [row.key]: event.target.checked }))} /> 跳过生成</label>
            {row.candidates.length === 1 && !row.defaultWordId && <small>重叠不超过 10ms；需人工指定。</small>}
            {row.candidates.length > 1 && <small>跨词重叠；建议：{line.words.find((word) => word.id === row.suggestedWordId)?.text}，仍需人工指定。</small>}
            {!row.candidates.length && <small>{row.beginUs === null || row.endUs === null ? '源时间未定' : '没有正重叠词'}；需人工指定。</small>}
            {row.conversionIssue && <small role="alert">{row.conversionIssue}</small>}
          </div>;
        }} />
        {existingWords.length > 0 && <fieldset className={styles.rubyGenerationChoices}><legend>已有 注音</legend>{existingWords.map(({ word }) => <label key={word.id}><input type="checkbox" checked={overwrite.has(word.id)} onChange={(event) => setOverwrite((current) => { const next = new Set(current); if (event.target.checked) next.add(word.id); else next.delete(word.id); return next; })} />覆盖「{word.text}」现有 注音 及其对齐结果</label>)}</fieldset>}
        {!rows.length && <p role="status">没有可生成的音译单元</p>}
        {allSkipped && <p role="status">所有单元均跳过，无需生成</p>}
        {(issue || message) && <p role="alert">{message || issue}</p>}
      </>}
    </div>
  </SettingsDialog>;
}
