import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n, formatMessage } from '../../i18n';
import { useTranslation } from 'react-i18next';
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

const time = (value: number | null) => value === null ? t('ruby.untimed') : `${(value / 1e3).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
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
  useTranslation();
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
  useTranslation();
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
  const [message, setMessage] = useMessageText('');
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
    const matching = !skipped.has(row.key) && !row.wordId ? row.candidates.length > 1 ? t('ruby.crossWord') : row.candidates.length === 1 ? t('ruby.smallOverlap') : row.beginMs === null || row.endMs === null ? t('ruby.sourceUntimed') : t('ruby.noOverlap') : '';
    return [ordered.map(issue => formatMessage(issue.detail)).join(t('notice.separator')), matching, `${time(row.beginMs)} – ${time(row.endMs)}`].filter(Boolean).join(t('notice.separator'));
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
    } catch (cause) { setMessage(errorMessage(cause)); }
  };
  const ordinals = new Map(sourceDocument.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1]));
  const lineLabel = (id: string) => { const line = sourceDocument.lines.find(line => line.id === id)!; return `L${ordinals.get(line.backgroundOf ?? id)}${line.backgroundOf ? t('editor.backgroundSuffix') : ''}`; };
  const generatedLines = new Set(sourceRows.map(row => row.lineId)).size;
  return <div onKeyDownCapture={event => {
    if (event.key === 'Escape' && hint) { event.preventDefault(); event.stopPropagation(); setHint(null); }
  }}><SettingsDialog title={t('editor.rubyFromRomanization')} subtitle={lineIds.length === 1 && generatedLines === 1 ? lineLabel(lineIds[0]) : t('reading.generatedLines',{generated:generatedLines,total:lineIds.length})} close={close} actions={<><button className={styles.rubyPatrol} data-role="secondary" disabled={stale || !issues.length} onClick={() => navigate(nextRubyIssue(issues, currentIssue))}>{t('ruby.nextIssue')}</button><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={!canGenerate} onClick={submit}>{t('ruby.generate')}</button></>}>
    <div className={styles.rubyGeneration}>
      {stale ? <p role="alert">{t('ruby.documentChanged')}<button data-role="secondary" onClick={refresh}>{t('ruby.regenerate')}</button></p> : <>
        <div className={styles.rubyGenerationOptions}><label>{t('ruby.sourceTrack')}<Select value={trackId} onChange={(event) => selectTrack(event.target.value)}>{tracks.map((track, index) => <option key={track.id} value={track.id}>{t('editor.track')}{index + 1} · {track.language ?? t('editor.unspecifiedLanguage')}</option>)}</Select></label>
          <label>{t('ruby.characters')}<Select value={output} onChange={(event) => { setOutput(event.target.value as RubyOutput); resetPatrol(); setReadings({}); setSkipOverrides({}); setMessage(''); }}><option value="roman">{t('ruby.keepLatin')}</option><option value="hiragana">{t('ruby.toHiragana')}</option><option value="katakana">{t('ruby.toKatakana')}</option></Select></label></div>
        <Disclosure className={styles.sourceChoices} title={t('ruby.sourceContent')}>{() => <fieldset className={styles.rubyGenerationChoices}><legend>{t('ruby.selectContent')}</legend>{contents.map((content) => {
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
            <label>{t('ruby.targetWord')}<Select aria-label={t('ruby.targetWord')} value={selected} quotes={Object.fromEntries(line.words.map((word, index) => [word.id, { prefix: `${index + 1} · `, text: word.text }]))} data-attention={attention(['target', 'link', 'overwrite']) || undefined} aria-invalid={invalid(['target'])} aria-describedby={descriptionId} disabled={skipped.has(row.key)} onChange={(event) => { const nextWordId = event.target.value || null;
                setSkipOverrides(current => Object.fromEntries(Object.entries(current).filter(([key]) => {
                  const affected = rows.find(item => item.key === key)!;
                  return affected.lineId !== row.lineId || affected.wordId !== row.wordId && affected.wordId !== nextWordId;
                })));
                setAssignments((current) => ({ ...current, [row.key]: nextWordId })); setReadings((current) => { const next = { ...current }; delete next[row.key]; return next; }); }}>
              <option value="">{t('ruby.manualAssignment')}</option>{line.words.map((word, index) => <option key={word.id} value={word.id}>{index + 1} · {word.text}{row.candidates.includes(word.id) ? t('ruby.overlapSuffix') : ''}</option>)}
            </Select></label>
            <label>{t('ruby.targetReading')}<input aria-describedby={descriptionId} aria-invalid={invalid(['reading'])} data-attention={attention(['reading', 'kana-difference', 'link', 'overwrite']) || undefined} value={readings[row.key] ?? row.reading ?? ''} disabled={skipped.has(row.key)} onChange={(event) => setReadings((current) => ({ ...current, [row.key]: event.target.value }))} /></label>
            <label><input type="checkbox" checked={skipped.has(row.key)} onChange={(event) => setSkipOverrides(current => ({ ...current, [row.key]: event.target.checked }))} /> {t('ruby.skip')}</label>
          </div>;
        }} />
        {existingWords.length > 0 && <fieldset className={styles.rubyGenerationChoices}><legend>{t('ruby.existing')}</legend>{existingWords.map(({ line, word }) => <label key={word.id}><input ref={node => { if (node) overwriteNodes.current.set(word.id, node); else overwriteNodes.current.delete(word.id); }}
          aria-invalid={!overwrite.has(word.id) || undefined} data-attention={!overwrite.has(word.id) || undefined}
          aria-describedby={`ruby-overwrite-${word.id}`} type="checkbox" checked={overwrite.has(word.id)} onChange={(event) => setOverwrite((current) => { const next = new Set(current); if (event.target.checked) next.add(word.id); else next.delete(word.id); return next; })} />{t('ruby.overwrite')}<strong>{word.text}</strong> {t('ruby.existingAlignment')}<span id={`ruby-overwrite-${word.id}`}>{lineLabel(line.id)} · <strong>{rows.filter(row => row.wordId === word.id && !skipped.has(row.key)).map(row => row.sourceText).join(' / ')}</strong>{t('notice.separator')}{overwrite.has(word.id) ? t('ruby.overwriteSelected') : t('ruby.confirmOverwrite')}</span></label>)}</fieldset>}
        {!rows.length && <p role="status">{t('ruby.noUnits')}</p>}
        {allSkipped && <p role="status">{t('ruby.allSkipped')}</p>}
        <div className={styles.rubyIssueList} aria-label={t('ruby.issues')}>
          {issues.map(issue => <button key={issue.id} data-role="inline" onClick={() => navigate(issue)}>
            <span>{issue.severity === 'error' ? t('validation.blocking') : t('common.review')} · {lineLabel(issue.lineId)}</span>
            <strong>{rows.filter(row => issue.rowKeys.includes(row.key)).map(row => row.sourceText).join(' / ')}</strong>
            <span>{formatMessage(issue.detail)}</span>
          </button>)}
        </div>
        {message && <p role="alert">{message}</p>}
        {hint && <div ref={hintRef} role="tooltip" className={styles.rubyHint} style={hintRect}>{rows.some(row => row.key === hint.key) ? describeRow(rows.find(row => row.key === hint.key)!) : hint.text}</div>}
      </>}
    </div>
  </SettingsDialog></div>;
}

const t=i18n.t.bind(i18n);
