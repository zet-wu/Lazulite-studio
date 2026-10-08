import { Disclosure } from '../../shared/Disclosure';
import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { LyricCommand } from '../../domain/lyric-commands';
import { type LyricDocument } from '../../domain/lyric-document';
import { defaultRubySkips, nextRubyIssue, rubyGenerationIssues, proposeRuby, rubyGenerationCommand, rubySourceRows, type RubyOutput, type RubyProposalRow, type RubyIssue } from '../../domain/ruby-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

const time = (value: number | null) => value === null ? '未定' : `${(value / 1e3).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
const firstContents = (document: LyricDocument, trackId: string, lineIds: string[], preferred?: string) => {
  const contents = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  if (preferred && contents.some((content) => content.id === preferred)) return [preferred];
  const seen = new Set<string>();
  return contents.filter((content) => { if (seen.has(content.lineId)) return false; seen.add(content.lineId); return true; }).map((content) => content.id);
};

type Navigation = { issue: RubyIssue; serial: number };
function RubyProposalRows({ rows, renderRow, navigation }: {
  rows: RubyProposalRow[]; renderRow: (row: RubyProposalRow) => ReactNode; navigation: Navigation | null;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const completedNavigation = useRef<Navigation | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const virtualized = rows.length > 80;
  const rowKey = useCallback((index: number) => rows[index].key, [rows]);
  const virtualizer = useVirtualizer({ count: virtualized ? rows.length : 0, getScrollElement: () => rowsRef.current,
    estimateSize: () => 70, overscan: 6, getItemKey: rowKey,
    rangeExtractor: range => {
      const visible = defaultRangeExtractor(range), index = rows.findIndex(row => row.key === focused);
      return index < 0 || visible.includes(index) ? visible : [...visible, index].sort((a, b) => a - b);
    } });
  useLayoutEffect(() => {
    if (!navigation || completedNavigation.current === navigation || navigation.issue.kind === 'overwrite') return;
    const { issue } = navigation;
    const index = rows.findIndex(row => row.key === issue.rowKey);
    if (index < 0) return;
    rowsRef.current?.scrollIntoView({ block: 'nearest' });
    if (virtualized) virtualizer.scrollToIndex(index, { align: 'center' });
    let frame: number;
    let measured = false;
    const locate = () => {
      const node = nodes.current.get(issue.rowKey);
      if (!node) { frame = requestAnimationFrame(locate); return; }
      if (!measured) {
        if (virtualized) { virtualizer.measureElement(node); virtualizer.scrollToIndex(index, { align: 'center' }); }
        measured = true; frame = requestAnimationFrame(locate); return;
      }
      const control = node.querySelector<HTMLElement>(issue.kind === 'target' ? 'select' : issue.kind === 'link' ? '[data-ruby-source]' : 'input:not([type="checkbox"])');
      node.scrollIntoView({ block: 'nearest' });
      control?.focus({ preventScroll: true });
      completedNavigation.current = navigation;
    };
    frame = requestAnimationFrame(locate);
    return () => cancelAnimationFrame(frame);
  }, [navigation, virtualized, virtualizer, rows]);
  const displayed = virtualized ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], item })) : rows.map(row => ({ row, item: null }));
  return <div ref={rowsRef} data-proposal-count={rows.length} className={`${styles.rubyGenerationRows} ${virtualized ? styles.rubyGenerationRowsVirtual : ''}`}>
    <div style={virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}>
      {displayed.map(({ row, item }) => <div key={row.key} data-index={item?.index} ref={node => {
        if (node) { nodes.current.set(row.key, node); if (item) virtualizer.measureElement(node); }
        else nodes.current.delete(row.key);
      }} onFocusCapture={() => setFocused(row.key)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
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
  const editing = useProjectEditing();
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
  const [currentIssue, setCurrentIssue] = useState<RubyIssue | null>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [hint, setHint] = useState<{ key: string; text: string; anchor: HTMLElement } | null>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const [hintRect, setHintRect] = useState({ left: 0, top: 0 });
  const overwriteNodes = useRef(new Map<string, HTMLInputElement>());
  useLayoutEffect(() => {
    if (!hint) return;
    const place = () => {
      const rect = hint.anchor.getBoundingClientRect();
      const height = hintRef.current?.offsetHeight ?? 60;
      setHintRect({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 330)),
        top: rect.top >= height + 12 ? rect.top - height - 6 : Math.min(rect.bottom + 6, window.innerHeight - height - 8) });
    };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [hint, readings, assignments, skipOverrides, overwrite]);
  const stale = document !== sourceDocument;
  const contents = tracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  const sourceRows = useMemo(() => contentIds.length && trackId ? rubySourceRows(sourceDocument, trackId, contentIds) : [], [sourceDocument, trackId, contentIds]);
  const rows = useMemo(() => proposeRuby(sourceRows, output, assignments), [sourceRows, output, assignments]);
  const defaultSkipped = useMemo(() => defaultRubySkips(sourceDocument, rows, output, readings), [sourceDocument, rows, output, readings]);
  const skipped = new Set(rows.filter(row => Object.hasOwn(skipOverrides, row.key) ? skipOverrides[row.key] : defaultSkipped.has(row.key)).map(row => row.key));
  const allSkipped = rows.length > 0 && skipped.size === rows.length;
  const chosenWords = new Set(rows.filter((row) => !skipped.has(row.key)).map((row) => row.wordId).filter((id): id is string => Boolean(id)));
  const existingWords = sourceDocument.lines.flatMap((line) => line.words.filter((word) => chosenWords.has(word.id) && word.rubyUnits.length).map((word) => ({ line, word })));
  const issues = rubyGenerationIssues(sourceDocument, rows, readings, skipped, overwrite, output, editing);
  const describeRow = (row: RubyProposalRow) => {
    const rowIssues = issues.filter(issue => issue.rowKeys.includes(row.key));
    const ordered = [...rowIssues].sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'));
    const matching = !skipped.has(row.key) && !row.wordId ? row.candidates.length > 1 ? '跨词重叠；需人工指定。' : row.candidates.length === 1 ? '重叠不超过 50ms；需人工指定。' : row.beginMs === null || row.endMs === null ? '源时间未定；需人工指定。' : '没有正重叠词；需人工指定。' : '';
    return [ordered.map(issue => issue.message).join('；'), matching, `${time(row.beginMs)} – ${time(row.endMs)}`].filter(Boolean).join('；');
  };
  const canGenerate = !stale && rows.length > 0 && !allSkipped && !issues.some(issue => issue.severity === 'error');
  const navigate = (issue: RubyIssue | null) => {
    if (!issue || stale) return;
    setCurrentIssue(issue); setHint(null);
    setNavigation(previous => ({ issue, serial: (previous?.serial ?? 0) + 1 }));
    if (issue.kind === 'overwrite' && issue.wordId) {
      const node = overwriteNodes.current.get(issue.wordId);
      node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true });
    }
  };
  const resetPatrol = () => { setCurrentIssue(null); setNavigation(null); setHint(null); };
  const resetChoices = () => { setAssignments({}); setReadings({}); setSkipOverrides({}); setOverwrite(new Set()); setMessage(''); resetPatrol(); };
  const selectTrack = (id: string) => { setTrackId(id); setContentIds(firstContents(sourceDocument, id, lineIds)); resetChoices(); };
  const refresh = () => {
    const available = document.romanizationTracks.filter((track) => track.contents.some((content) => lineIds.includes(content.lineId)));
    const nextTrackId = available.some((track) => track.id === trackId) ? trackId : available[0]?.id ?? '';
    setSourceDocument(document); setTrackId(nextTrackId); setContentIds(firstContents(document, nextTrackId, lineIds)); resetChoices();
  };
  const submit = () => {
    try {
      const result = rubyGenerationCommand(document, sourceDocument, rows, readings, skipped, overwrite, editing);
      if (apply(result)) close();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '生成 注音 失败'); }
  };
  const ordinals = new Map(sourceDocument.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1]));
  const lineLabel = (id: string) => { const line = sourceDocument.lines.find(line => line.id === id)!; return `L${ordinals.get(line.backgroundOf ?? id)}${line.backgroundOf ? ' · 背景' : ''}`; };
  const generatedLines = new Set(sourceRows.map(row => row.lineId)).size;
  return <div onKeyDownCapture={event => {
    if (event.key === 'Escape' && hint) { event.preventDefault(); event.stopPropagation(); setHint(null); }
  }}><SettingsDialog title="从音译生成 注音" subtitle={lineIds.length === 1 && generatedLines === 1 ? lineLabel(lineIds[0]) : `生成 ${generatedLines} / ${lineIds.length} 行`} close={close} actions={<><button className={styles.rubyPatrol} data-role="secondary" disabled={stale || !issues.length} onClick={() => navigate(nextRubyIssue(issues, currentIssue))}>下一处错误／警告</button><button data-role="secondary" onClick={close}>取消</button><button data-role="primary" disabled={!canGenerate} onClick={submit}>生成 注音</button></>}>
    <div className={styles.rubyGeneration}>
      {stale ? <p role="alert">文档已变化，旧提案不能应用。<button data-role="secondary" onClick={refresh}>重新生成提案</button></p> : <>
        <div className={styles.rubyGenerationOptions}><label>音译轨道 <Select value={trackId} onChange={(event) => selectTrack(event.target.value)}>{tracks.map((track, index) => <option key={track.id} value={track.id}>轨道 {index + 1} · {track.language ?? '未指定语言'}</option>)}</Select></label>
          <label>字符输出 <Select value={output} onChange={(event) => { setOutput(event.target.value as RubyOutput); resetPatrol(); setReadings({}); setSkipOverrides({}); setMessage(''); }}><option value="roman">保持罗马字</option><option value="hiragana">转换为平假名</option><option value="katakana">转换为片假名</option></Select></label></div>
        <Disclosure className={styles.sourceChoices} title="音译内容">{() => <fieldset className={styles.rubyGenerationChoices}><legend>选取具体音译内容</legend>{contents.map((content) => {
          const line = sourceDocument.lines.find((item) => item.id === content.lineId)!;
          return <label key={content.id}><input type="checkbox" checked={contentIds.includes(content.id)} onChange={(event) => { setContentIds((ids) => event.target.checked ? [...ids, content.id] : ids.filter((id) => id !== content.id)); resetChoices(); }} />
            {lineLabel(line.id)} · {content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}
          </label>;
        })}</fieldset>}</Disclosure>
        <RubyProposalRows rows={rows} navigation={navigation} renderRow={row => {
          const line = sourceDocument.lines.find((item) => item.id === row.lineId)!;
          const selected = Object.hasOwn(assignments, row.key) ? assignments[row.key] ?? '' : row.defaultWordId ?? '';
          const rowIssues = issues.filter(issue => issue.rowKeys.includes(row.key));
          const explanation = describeRow(row);
          const descriptionId = `ruby-description-${encodeURIComponent(row.key)}`;
          const attention = (kinds: RubyIssue['kind'][]) => rowIssues.some(issue => kinds.includes(issue.kind));
          const invalid = (kinds: RubyIssue['kind'][]) => rowIssues.some(issue => issue.severity === 'error' && kinds.includes(issue.kind)) || undefined;
          const showHint = (anchor: HTMLElement) => setHint({ key: row.key, text: explanation, anchor });
          return <div className={styles.rubyGenerationRow} data-ruby-row={row.key}
            onFocusCapture={event => showHint(event.target as HTMLElement)}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHint(null); }}>
            <div className={styles.rubySource} data-ruby-source tabIndex={0} aria-describedby={descriptionId}
              onMouseEnter={event => showHint(event.currentTarget)} onMouseLeave={() => setHint(null)}>
              <small>{lineLabel(line.id)}</small><strong>{row.sourceText}</strong>
            </div>
            <span id={descriptionId} className={styles.rubyDescription}>{explanation}</span>
            <label>目标词 <Select aria-label="目标词" value={selected} quotes={Object.fromEntries(line.words.map((word, index) => [word.id, { prefix: `${index + 1} · `, text: word.text }]))} data-attention={attention(['target', 'link', 'overwrite']) || undefined} aria-invalid={invalid(['target'])} aria-describedby={descriptionId} disabled={skipped.has(row.key)} onChange={(event) => { const nextWordId = event.target.value || null;
                setSkipOverrides(current => Object.fromEntries(Object.entries(current).filter(([key]) => {
                  const affected = rows.find(item => item.key === key)!;
                  return affected.lineId !== row.lineId || affected.wordId !== row.wordId && affected.wordId !== nextWordId;
                })));
                setAssignments((current) => ({ ...current, [row.key]: nextWordId })); setReadings((current) => { const next = { ...current }; delete next[row.key]; return next; }); }}>
              <option value="">待人工分配</option>{line.words.map((word, index) => <option key={word.id} value={word.id}>{index + 1} · {word.text}{row.candidates.includes(word.id) ? ' · 时间重叠' : ''}</option>)}
            </Select></label>
            <label>目标 注音 <input aria-describedby={descriptionId} aria-invalid={invalid(['reading'])} data-attention={attention(['reading', 'kana-difference', 'link', 'overwrite']) || undefined} value={readings[row.key] ?? row.reading ?? ''} disabled={skipped.has(row.key)} onChange={(event) => setReadings((current) => ({ ...current, [row.key]: event.target.value }))} /></label>
            <label><input type="checkbox" checked={skipped.has(row.key)} onChange={(event) => setSkipOverrides(current => ({ ...current, [row.key]: event.target.checked }))} /> 跳过生成</label>
          </div>;
        }} />
        {existingWords.length > 0 && <fieldset className={styles.rubyGenerationChoices}><legend>已有 注音</legend>{existingWords.map(({ line, word }) => <label key={word.id}><input ref={node => { if (node) overwriteNodes.current.set(word.id, node); else overwriteNodes.current.delete(word.id); }}
          aria-invalid={!overwrite.has(word.id) || undefined} data-attention={!overwrite.has(word.id) || undefined}
          aria-describedby={`ruby-overwrite-${word.id}`} type="checkbox" checked={overwrite.has(word.id)} onChange={(event) => setOverwrite((current) => { const next = new Set(current); if (event.target.checked) next.add(word.id); else next.delete(word.id); return next; })} />覆盖 <strong>{word.text}</strong> 现有 注音 及其对齐结果
          <span id={`ruby-overwrite-${word.id}`}>{lineLabel(line.id)} · <strong>{rows.filter(row => row.wordId === word.id && !skipped.has(row.key)).map(row => row.sourceText).join(' / ')}</strong>；{overwrite.has(word.id) ? '已选择覆盖' : '请显式选择覆盖'}</span></label>)}</fieldset>}
        {!rows.length && <p role="status">没有可生成的音译单元</p>}
        {allSkipped && <p role="status">所有单元均跳过，无需生成</p>}
        <div className={styles.rubyIssueList} aria-label="注音生成问题">
          {issues.map(issue => <button key={issue.id} data-role="inline" onClick={() => navigate(issue)}>
            <span>{issue.severity === 'error' ? '阻塞' : '核对'} · {lineLabel(issue.lineId)}</span>
            <strong>{rows.filter(row => issue.rowKeys.includes(row.key)).map(row => row.sourceText).join(' / ')}</strong>
            <span>{issue.message}</span>
          </button>)}
        </div>
        {message && <p role="alert">{message}</p>}
        {hint && <div ref={hintRef} role="tooltip" className={styles.rubyHint} style={hintRect}>{rows.some(row => row.key === hint.key) ? describeRow(rows.find(row => row.key === hint.key)!) : hint.text}</div>}
      </>}
    </div>
  </SettingsDialog></div>;
}
