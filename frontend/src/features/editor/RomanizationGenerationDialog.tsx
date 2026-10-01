import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { LyricDocument, LyricWord } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { prepareRomanization, proposeRomanization, romanizationGenerationCommand, type RomanizationKind, type GeneratedUnit, type RomanizationProposal } from '../../domain/romanization-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

function ProposalText({ text, hint, label, multiline, change, focus }: {
  text: string; hint: string; label: string; multiline?: boolean; change: (text: string) => void; focus: (active: boolean) => void;
}) {
  const start = useRef(text), composing = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const resize = () => { if (area.current) { area.current.style.height = 'auto'; area.current.style.height = `${area.current.scrollHeight}px`; } };
    resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [text]);
  const common = {
    'aria-label': label, 'aria-description': hint || undefined, title: hint || undefined,
    value: text, placeholder: '空格占位', className: `${styles.romanPreviewInput} ${hint ? styles.romanPreviewHint : ''}`,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
    onFocus: () => { start.current = text; focus(true); },
    onBlur: () => { if (!text) change(' '); focus(false); },
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); change(start.current); }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea {...common} ref={area} rows={1} /> : <input {...common} style={{ width: `${Math.max(3, Math.min(32, Array.from(text).length + 1))}ch` }} />;
}

function TimedWordPreview({ word, units, lineLabel, change, focus }: {
  word: LyricWord; units: Array<{ unit: GeneratedUnit; index: number }>; lineLabel: string;
  change: (text: string, key: string) => void; focus: (active: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!, text = body.current!;
    const slots = Array.from(element.querySelectorAll<HTMLElement>('[data-preview-unit]'));
    // Keep the inputs mounted when wrapping changes, including during IME input.
    const layout = () => {
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
  }, [word, units.length]);
  const readings = new Map(word.rubyUnits.map(unit => [unit.id, unit.reading]));
  return <div ref={root} className={`${styles.romanPreviewWord} ${styles.romanPreviewTimedWord}`} data-source-word={word.id}
    style={{ minWidth: `min(100%, ${Array.from(word.text).length * 22}px)` }}>
    <div ref={body} className={styles.romanPreviewBody}>{word.text}</div>
    {units.map(({ unit, index }) => {
      const reading = readings.get(unit.key) ?? '';
      const inputWidth = Math.max(3, Math.min(32, Array.from(unit.text).length + 1));
      const width = `min(32ch, max(${Array.from(reading).length * 12}px, ${inputWidth}ch))`;
      return <div key={unit.key} className={styles.romanPreviewSlot} style={{ width }} data-preview-unit={unit.key}>
        <div data-source-unit={unit.key}><div className={styles.romanPreviewReading}>{reading}</div></div>
        <div data-generated-unit={unit.key}><ProposalText text={unit.text} hint={unit.hint} label={`${lineLabel}单元 ${index + 1}音译`}
          change={text => change(text, unit.key)} focus={focus} /></div>
      </div>;
    })}
  </div>;
}
export function RomanizationGenerationDialog({ document, lineIds, preferenceScope, apply, close }: {
  document: LyricDocument; lineIds: string[]; preferenceScope: string; apply: (command: LyricCommand) => boolean; close: () => void;
}) {
  const [source] = useState(document);
  const [sourceIds] = useState(lineIds);
  const modeStorage = `lazulite-romanization-mode:${preferenceScope}`;
  const [kind, setKind] = useState<RomanizationKind>(() => localStorage.getItem(modeStorage) === 'timed' ? 'timed' : 'plain');
  const [rows, setRows] = useState<RomanizationProposal[]>(() => proposeRomanization(source, sourceIds, kind));
  const [trackId, setTrackId] = useState(() => source.romanizationTracks.find(track => track.language === 'ja-Latn')?.id ?? '');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
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
  const targetFor = (lineId: string) => targets[lineId] ?? (track?.contents.some(content => content.lineId === lineId) ? 'skip' : 'append');
  let issue = '';
  try { prepareRomanization(document, source, rows, { trackId: trackId || null, targets }); }
  catch (cause) { issue = (cause as Error).message; }
  const changeText = (lineId: string, text: string, key?: string) => setRows(current => current.map(row => row.lineId !== lineId ? row : row.kind === 'timed'
    ? { ...row, groups: row.groups.map(unit => unit.key === key ? { ...unit, text, hint: text.trim() ? '' : '音译空格占位，可直接应用' } : unit) }
    : { ...row, text, hint: text.trim() ? '' : '音译空格占位，可直接应用' }));
  const submit = () => {
    try { if (apply(romanizationGenerationCommand(document, source, rows, { trackId: trackId || null, targets }))) close(); }
    catch (cause) { setMessage((cause as Error).message); }
  };
  return <SettingsDialog title="生成日文罗马字音译" subtitle={`生成 ${rows.filter(row => targetFor(row.lineId) !== 'skip').length} / ${sourceIds.length} 行`} close={close}
    actions={<><button onClick={close}>取消</button><button disabled={Boolean(issue)} onClick={submit}>生成音译</button></>}>
    <div className={styles.rubyGeneration}>
      <small>使用 注音 读音及假名正文</small>
      <div className={styles.rubyGenerationOptions}>
        <label>目标轨道 <select aria-label="目标轨道" value={trackId} onChange={event => { setTrackId(event.target.value); setTargets({}); setMessage(''); }}><option value="">新建 · ja-Latn</option>
          {source.romanizationTracks.filter(track => track.language === 'ja-Latn').map(track => <option key={track.id} value={track.id}>轨道 {source.romanizationTracks.indexOf(track) + 1} · ja-Latn</option>)}
        </select></label>
        <label>输出 <select aria-label="输出" aria-describedby="romanization-mode-help" value={kind} onChange={event => {
          const next = event.target.value as RomanizationKind;
          setKind(next); setRows(proposeRomanization(source, sourceIds, next)); setMessage(''); setFocusedRow(null);
          localStorage.setItem(modeStorage, next);
        }}><option value="plain">普通文本</option><option value="timed">按源分词定时</option></select></label>
      </div>
      <small id="romanization-mode-help">切换输出会重新生成，清除本窗口的文字修改</small>
      <div ref={scroll} data-proposal-count={rows.length} className={`${styles.rubyGenerationRows} ${virtualized ? styles.rubyGenerationRowsVirtual : ''}`}>
        <div style={virtualized ? { position: 'relative', height: virtualizer.getTotalSize() } : { display: 'grid', gap: 8 }}>
          {shown.map(({ row, item }) => {
            const byWord = new Map<string, Array<{ unit: GeneratedUnit; index: number }>>();
            if (row.kind === 'timed') row.groups.forEach((unit, index) => { const list = byWord.get(unit.wordId) ?? []; list.push({ unit, index }); byWord.set(unit.wordId, list); });
            return <div key={row.lineId} ref={item ? virtualizer.measureElement : undefined} data-index={item?.index} data-roman-proposal={row.lineId}
            style={item ? { position: 'absolute', width: '100%', transform: `translateY(${item.start}px)` } : undefined} className={`${styles.rubyGenerationRow} ${styles.romanGenerationRow}`}>
            <label>L{ordinals.get(row.lineId)} <select aria-label={`L${ordinals.get(row.lineId)}生成内容`} value={targetFor(row.lineId)} onChange={event => setTargets(current => ({ ...current, [row.lineId]: event.target.value }))}>
              <option value="skip">跳过 · 保留已有</option><option value="append">添加新内容</option>
              {track?.contents.filter(content => content.lineId === row.lineId).map(content => <option key={content.id} value={content.id}>替换 · {content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('')}</option>)}
            </select></label>
            <div className={styles.romanPreviewWords}>
              {lines.get(row.lineId)!.words.map(word => row.kind === 'timed'
                ? <TimedWordPreview key={word.id} word={word} units={byWord.get(word.id) ?? []} lineLabel={`L${ordinals.get(row.lineId)}`}
                  change={(text, key) => changeText(row.lineId, text, key)} focus={active => setFocusedRow(active ? row.lineId : null)} />
                : <div key={word.id} className={styles.romanPreviewWord} data-source-word={word.id}>
                  <div className={styles.romanPreviewReading}>{word.rubyUnits.map(unit => unit.reading).join(' ')}</div>
                  <div className={styles.romanPreviewBody}>{word.text}</div>
                </div>)}
            </div>
            {row.kind === 'plain' && <ProposalText multiline text={row.text} hint={row.hint} label={`L${ordinals.get(row.lineId)}音译`}
              change={text => changeText(row.lineId, text)} focus={active => setFocusedRow(active ? row.lineId : null)} />}
          </div>; })}
        </div>
      </div>
      {kind === 'timed' && rows.some(row => row.kind === 'timed' && targetFor(row.lineId) !== 'skip' && row.groups.some(unit => unit.beginUs === null || unit.endUs === null)) && <small>源时间未定，生成后请在画布补全；最终定时导出要求完整时间。</small>}
      {(message || issue) && <p role="alert" className={styles.romanGenerationError}>{message || issue}</p>}
    </div>
  </SettingsDialog>;
}
