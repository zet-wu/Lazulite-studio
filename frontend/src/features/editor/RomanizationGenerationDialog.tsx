import { Tooltip } from '../../shared/Tooltip';
import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n, formatMessage } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { preferences } from '../../adapters/preferences';
import { measureTextWidth } from '../../shared/measure-text';
import { kanaHighlightHint, defaultKanaHighlight, normalizeKanaHighlight } from './kana-highlight';
import { Select } from '../../shared/Select';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { LyricDocument, LyricWord } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { hasGeneratedContent, prepareRomanization, proposeRomanization, romanizationGenerationCommand, type RomanizationKind, type GeneratedUnit, type RomanizationProposal } from '../../domain/romanization-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

function ProposalText({ text, hint, label, multiline, change, focus }: {
  text: string; hint: string; label: string; multiline?: boolean; change: (text: string) => void; focus: (active: boolean) => void;
}) {
  useTranslation();
  const start = useRef(text), composing = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const resize = () => { if (area.current) { area.current.style.height = 'auto'; area.current.style.height = `${area.current.scrollHeight}px`; } };
    resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [text]);
  const common = {
    'aria-label': label, 'aria-description': hint || undefined, title: [text, hint].filter(Boolean).join(t('notice.separator')),
    value: text, placeholder: t('romanization.emptySkip'), className: `${styles.romanPreviewInput} ${hint ? styles.romanPreviewHint : ''}`,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
    onFocus: () => { start.current = text; focus(true); },
    onBlur: () => { focus(false); },
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); change(start.current); }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea {...common} ref={area} rows={1} /> : <input {...common} style={{ width: '100%' }} />;
}

function TimedWordPreview({ word, units, lineLabel, change, focus, highlight }: {
  highlight: string; word: LyricWord; units: Array<{ unit: GeneratedUnit; index: number }>; lineLabel: string;
  change: (text: string, key: string) => void; focus: (active: boolean) => void;
}) {
  useTranslation();
  const root = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!, text = body.current!;
    const slots = Array.from(element.querySelectorAll<HTMLElement>('[data-preview-unit]'));
    // Keep the inputs mounted when wrapping changes, including during IME input.
    const layout = () => {
      slots.forEach(slot => {
        const input = slot.querySelector('input')!, reading = slot.querySelector<HTMLElement>('[data-source-unit] > div')!;
        const inputWidth = measureTextWidth(input, input.value || input.placeholder, true);
        const readingWidth = measureTextWidth(reading, reading.textContent!);
        slot.style.width = `${Math.min(384, Math.max(32, inputWidth, readingWidth))}px`;
      });
      const firstTop = slots[0]?.offsetTop;
      const readingHeight = Math.max(16, ...slots.map(slot => slot.querySelector<HTMLElement>('[data-source-unit]')!.offsetHeight));
      element.style.setProperty('--roman-reading-height', `${readingHeight}px`);
      element.style.setProperty('--roman-body-height', `${text.offsetHeight}px`);
      slots.forEach(slot => slot.toggleAttribute('data-first-preview-row', slot.offsetTop === firstTop));
    };
    layout();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(layout);
    });
    [element, text, ...slots].forEach(item => observer.observe(item));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [word, units]);
  const readings = new Map(word.rubyUnits.map(unit => [unit.id, unit.reading]));
  return <div ref={root} className={`${styles.romanPreviewWord} ${styles.romanPreviewTimedWord}`} data-source-word={word.id}
    style={{ minWidth: `min(100%, ${Array.from(word.text).length * 22}px)` }}>
    <div ref={body} className={styles.romanPreviewBody}>{word.text}</div>
    {units.map(({ unit, index }) => {
      const reading = readings.get(unit.key) ?? word.text;
      const kanaHint = kanaHighlightHint(reading, highlight);
      return <div key={unit.key} className={styles.romanPreviewSlot} data-preview-unit={unit.key}>
        <div data-source-unit={unit.key}><div tabIndex={kanaHint ? 0 : undefined} title={kanaHint || undefined} aria-description={kanaHint || undefined} className={`${styles.romanPreviewReading} ${kanaHint ? styles.romanPreviewHint : ''}`}>{reading}</div></div>
        <div data-generated-unit={unit.key}><ProposalText text={unit.text} hint={[unit.hint.split(';').filter(Boolean).map(key=>t(key)).join(t('notice.separator')), kanaHint].filter(Boolean).join(t('notice.separator'))} label={t('reading.unitRomanization',{line:lineLabel,number:index+1})}
          change={text => change(text, unit.key)} focus={focus} /></div>
      </div>;
    })}
  </div>;
}
export function RomanizationGenerationDialog({ document, lineIds, preferenceScope, apply, close }: {
  document: LyricDocument; lineIds: string[]; preferenceScope: string; apply: (command: LyricCommand) => boolean; close: () => void;
}) {
  useTranslation();
  const [source] = useState(document);
  const [highlight, setHighlight] = useState(defaultKanaHighlight);
  const [highlightInput, setHighlightInput] = useState(defaultKanaHighlight);
  const [highlightError, setHighlightError] = useMessageText('');
  const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const updateHighlight = (value: string) => {
    try { setHighlight(normalizeKanaHighlight(value)); setHighlightError(''); }
    catch (cause) { setHighlightError(errorMessage(cause)); }
  };
  const [sourceIds] = useState(lineIds);
  const modeStorage = `lazulite-romanization-mode:${preferenceScope}`;
  const [kind, setKind] = useState<RomanizationKind>(() => preferences.getItem(modeStorage) === 'plain' ? 'plain' : 'timed');
  const [rows, setRows] = useState<RomanizationProposal[]>(() => proposeRomanization(source, sourceIds, kind));
  const [trackId, setTrackId] = useState(() => source.romanizationTracks.find(track => track.language === 'ja-Latn')?.id ?? '');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [message, setMessage] = useMessageText('');
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 80;
  const virtualizer = useVirtualizer({ count: virtualized ? rows.length : 0, getScrollElement: () => scroll.current, estimateSize: () => 180, overscan: 3, getItemKey: index => rows[index].lineId,
    rangeExtractor: range => {
      const indices = defaultRangeExtractor(range), active = rows.findIndex(row => row.lineId === focusedRow);
      return active < 0 || indices.includes(active) ? indices : [...indices, active].sort((a, b) => a - b);
    },
  });
  const shown = virtualized ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], item })) : rows.map(row => ({ row, item: null }));
  const track = source.romanizationTracks.find(item => item.id === trackId);
  const lines = useMemo(() => new Map(source.lines.map(line => [line.id, line])), [source]);
  const ordinals = useMemo(() => new Map(source.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1])), [source]);
  const lineLabel = (id: string) => { const line = source.lines.find(line => line.id === id)!; return `L${ordinals.get(line.backgroundOf ?? id)}${line.backgroundOf ? t('editor.backgroundSuffix') : ''}`; };
  const targetFor = (lineId: string) => targets[lineId] ?? (track?.contents.some(content => content.lineId === lineId) ? 'skip' : 'append');
  let issue = '';
  try { prepareRomanization(document, source, rows, { trackId: trackId || null, targets }); }
  catch (cause) { issue = formatMessage(errorMessage(cause)); }
  const changeText = (lineId: string, text: string, key?: string) => setRows(current => current.map(row => row.lineId !== lineId ? row : row.kind === 'timed'
    ? { ...row, groups: row.groups.map(unit => unit.key === key ? { ...unit, text, hint: hasSplitHint(unit.hint) ? unit.hint : text.trim() ? '' : 'romanization.emptySkip' } : unit) }
    : { ...row, text, hint: hasSplitHint(row.hint) ? row.hint : text.trim() ? '' : 'romanization.emptySkip' }));
  const submit = () => {
    try { if (apply(romanizationGenerationCommand(document, source, rows, { trackId: trackId || null, targets }))) close(); }
    catch (cause) { setMessage(errorMessage(cause)); }
  };
  return <SettingsDialog title={t('editor.romanize')} subtitle={t('reading.generatedLines',{generated:rows.filter(row=>targetFor(row.lineId)!=='skip'&&hasGeneratedContent(row)).length,total:sourceIds.length})} close={close}
    actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={Boolean(issue)} onClick={submit}>{t('romanization.generate')}</button></>}>
    <div className={styles.rubyGeneration} onCompositionStart={() => { composing.current = true; setIsComposing(true); }} onCompositionEnd={() => { composing.current = false; setIsComposing(false); }}>
      <div className={`${styles.rubyGenerationOptions} ${styles.romanGenerationOptions}`}>
        <div className={styles.romanTrackOptions}><label>{t('romanization.targetTrack')}<Select aria-label={t('romanization.targetTrack')} value={trackId} onChange={event => { setTrackId(event.target.value); setTargets({}); setMessage(''); }}><option value="">{t('romanization.newLatin')}</option>
          {source.romanizationTracks.filter(track => track.language === 'ja-Latn').map(track => <option key={track.id} value={track.id}>{t('editor.track')}{source.romanizationTracks.indexOf(track) + 1} · ja-Latn</option>)}
        </Select></label>
        <label className={styles.kanaHighlight}>{t('kana.characters')}<input aria-label={t('kana.characters')} value={highlightInput} aria-invalid={Boolean(highlightError)} onChange={event => { setHighlightInput(event.target.value); if (!composing.current) updateHighlight(event.target.value); }} onCompositionEnd={event => updateHighlight(event.currentTarget.value)} /></label></div>
        {highlightError && <span role="alert">{highlightError}</span>}
        <label>{t('romanization.output')}<Tooltip content={t('romanization.switchClears')} id="romanization-mode-help"><Select aria-label={t('romanization.output')} aria-describedby="romanization-mode-help" disabled={isComposing} value={kind} onChange={event => {
          if (composing.current) return;
          const next = event.target.value as RomanizationKind;
          setKind(next); setRows(proposeRomanization(source, sourceIds, next)); setMessage(''); setFocusedRow(null);
          preferences.setItem(modeStorage, next);
        }}><option value="plain">{t('romanization.plain')}</option><option value="timed">{t('romanization.timed')}</option></Select></Tooltip></label>
      </div>
      <div ref={scroll} data-proposal-count={rows.length} className={`${styles.rubyGenerationRows} ${virtualized ? styles.rubyGenerationRowsVirtual : ''}`}>
        <div style={virtualized ? { position: 'relative', height: virtualizer.getTotalSize() } : { display: 'grid', gap: 8 }}>
          {shown.map(({ row, item }) => {
            const byWord = new Map<string, Array<{ unit: GeneratedUnit; index: number }>>();
            if (row.kind === 'timed') row.groups.forEach((unit, index) => { const list = byWord.get(unit.wordId) ?? []; list.push({ unit, index }); byWord.set(unit.wordId, list); });
            return <div key={row.lineId} ref={item ? virtualizer.measureElement : undefined} data-index={item?.index} data-roman-proposal={row.lineId}
            style={item ? { position: 'absolute', width: '100%', transform: `translateY(${item.start}px)` } : undefined} className={`${styles.rubyGenerationRow} ${styles.romanGenerationRow}`}>
            <label className={styles.romanTarget}>{lineLabel(row.lineId)} <Select quotes={Object.fromEntries((track?.contents.filter(content => content.lineId === row.lineId) ?? []).map(content => [content.id, { prefix: t('romanization.replace'), text: content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('') }]))} aria-label={t('reading.generatedContent',{line:lineLabel(row.lineId)})} value={targetFor(row.lineId)} onChange={event => setTargets(current => ({ ...current, [row.lineId]: event.target.value }))}>
              <option value="skip">{t('romanization.skipExisting')}</option><option value="append">{t('romanization.addContent')}</option>
              {track?.contents.filter(content => content.lineId === row.lineId).map(content => <option key={content.id} value={content.id}>{t('romanization.replace')}{content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('')}</option>)}
            </Select></label>
            {!hasGeneratedContent(row) && <small>{t('romanization.emptyPreserves')}</small>}
            <div className={styles.romanPreviewWords}>
              {lines.get(row.lineId)!.words.map(word => row.kind === 'timed'
                ? <TimedWordPreview highlight={highlight} key={word.id} word={word} units={byWord.get(word.id) ?? []} lineLabel={`${lineLabel(row.lineId)}`}
                  change={(text, key) => changeText(row.lineId, text, key)} focus={active => setFocusedRow(active ? row.lineId : null)} />
                : <div key={word.id} className={styles.romanPreviewWord} data-source-word={word.id}>
                  <div className={styles.romanPreviewReading}>{(word.rubyUnits.length ? word.rubyUnits.map(unit => unit.reading) : [word.text]).map((reading, index) => { const hint = kanaHighlightHint(reading, highlight); return <span key={index} tabIndex={hint ? 0 : undefined} title={hint || undefined} aria-description={hint || undefined} className={hint ? styles.romanPreviewHint : undefined}>{reading}</span>; })}</div>
                  <div className={styles.romanPreviewBody}>{word.text}</div>
                </div>)}
            </div>
            {row.kind === 'plain' && <ProposalText multiline text={row.text} hint={row.hint?t(row.hint):''} label={t('reading.lineRomanization',{line:lineLabel(row.lineId)})}
              change={text => changeText(row.lineId, text)} focus={active => setFocusedRow(active ? row.lineId : null)} />}
          </div>; })}
        </div>
      </div>
      {kind === 'timed' && rows.some(row => row.kind === 'timed' && targetFor(row.lineId) !== 'skip' && row.groups.some(unit => unit.text.trim() && (unit.beginMs === null || unit.endMs === null))) && <small>{t('romanization.untimedHelp')}</small>}
      {(message || issue) && <p role="alert" className={styles.romanGenerationError}>{message || issue}</p>}
    </div>
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);

const hasSplitHint=(hint:string)=>hint.split(';').some(key=>['romanization.specialYoon','romanization.reviewSplit','romanization.reviewResult'].includes(key));
