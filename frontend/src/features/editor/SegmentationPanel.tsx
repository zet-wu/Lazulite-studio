import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage, MessageError } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/Icon';
import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { SettingsDialog } from './SettingsDialog';
import { Fragment, useEffect, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, type LyricDocument, type LyricWord } from '../../domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, loadSyllableDivider, segmentText, segmentationPreview, SYLLABLE_LANGUAGES, type SegmentOptions } from '../../domain/segmentation';
import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

function Parts({ parts }: { parts: string[] }) {
  useTranslation();
  return <span className={styles.segmentParts}>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <Icon name="sync-beat"/>}<span>{part}</span></Fragment>)}</span>;
}

type PreviewItem = ReturnType<typeof segmentationPreview>[number];
type Props = { document: LyricDocument; selection: EditorSelection | null; currentLineId: string | null; apply: (command: LyricCommand) => boolean; close: () => void };
const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);

function targetWordIds(document: LyricDocument, selection: EditorSelection | null, currentLineId: string | null, scope: string, from: number, to: number): string[] {
  if (scope === 'selected' && selection?.kind === 'words') return selection.ids;
  const lines = document.lines.filter((line, index) => scope === 'all' || scope === 'range' && index + 1 >= from && index + 1 <= to ||
    scope === 'selected' && selection?.kind === 'lines' && selection.ids.includes(line.backgroundOf ?? line.id) ||
    scope === 'current' && line.id === currentLineId);
  return lines.flatMap((line) => line.words.map((word) => word.id));
}

function parseRules(input: string): SegmentOptions['rules'] {
  return input.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new MessageError(describeMessage('segment.ruleSyntax',{rule:line}));
    return { source: line.slice(0, separator).trim(), parts: line.slice(separator + 1).split('|').map((part) => part.trim()) };
  });
}

export function SegmentationPanel({ document, selection, currentLineId, apply, close }: Props) {
  useTranslation();
  const editing = useProjectEditing();
  const [mode, setMode] = useState<'manual' | 'auto' | 'advanced'>('manual');
  const [scope, setScope] = useState('current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(document.lines.length);
  const [options, setOptions] = useState<SegmentOptions>(DEFAULT_SEGMENT_OPTIONS);
  const [ignoreText, setIgnoreText] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [error, setError] = useMessageText('');
  const [manualBoundaries, setManualBoundaries] = useState<number[]>([]);
  const activeWord = selection?.kind === 'words' ? document.lines.flatMap((line) => line.words).find((word) => word.id === selection.activeId) :
    document.lines.find((line) => line.id === currentLineId)?.words[0];
  const manualLine = document.lines.find((line) => line.words.some((word) => word.id === activeWord?.id));
  const chars = activeWord ? graphemes(activeWord.text) : [];

  useEffect(() => { setPreview([]); setManualBoundaries([]); }, [document, activeWord?.id]);

  const updateOption = <K extends keyof SegmentOptions>(key: K, value: SegmentOptions[K]) => { setOptions((current) => ({ ...current, [key]: value })); setPreview([]); };
  const manualParts = (word: LyricWord, boundaries = manualBoundaries) => {
    const pieces = graphemes(word.text);
    const parts: string[] = [];
    let current = '';
    pieces.forEach((piece, index) => { current += piece; if (boundaries.includes(index + 1)) { parts.push(current); current = ''; } });
    if (current) parts.push(current);
    return parts;
  };
  const testRule = async () => {
    try {
      const config = { ...options, ignore: ignoreText.split('\n').map((item) => item.trim()).filter(Boolean), rules: parseRules(ruleText) };
      const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
      setTestOutput(segmentText(testInput, config, divide));
      setError('');
    } catch (cause) { setTestOutput([]); setError(errorMessage(cause)); }
  };
  const buildPreview = async () => {
    try {
      setError('');
      if (mode === 'manual') {
        if (!activeWord || !manualLine) throw new MessageError(describeMessage('segment.selectWord'));
        const parts = manualParts(activeWord);
        setPreview([{ lineId: manualLine.id, word: activeWord, parts, blocked: parts.length > 1 && Boolean(activeWord.rubyUnits.length || activeWord.obscene || emptyBeatCount(editing, activeWord.id)) }]);
        return;
      }
      const ids = targetWordIds(document, selection, currentLineId, scope, from, to);
      if (!ids.length) throw new MessageError(describeMessage('segment.noWords'));
      const config = { ...options, ignore: ignoreText.split('\n').map((item) => item.trim()).filter(Boolean), rules: parseRules(ruleText) };
      const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
      setPreview(segmentationPreview(document, ids, config, divide, editing));
    } catch (cause) { setPreview([]); setError(errorMessage(cause)); }
  };
  const commit = () => {
    try {
      const changed = preview.filter((item) => item.parts.length > 1 && !item.blocked);
      if (!changed.length) return;
      const changes = changed.map((item) => ({ lineId: item.lineId, wordId: item.word.id,
        words: distributeSegmentTime(item.word, item.parts, options.punctuationWeight, editing) }));
      if (apply({ type: 'segment-words', changes })) close();
    } catch (cause) { setError(errorMessage(cause)); }
  };
  return <SettingsDialog title={t('segment.title')} close={close} actions={<><button data-role="secondary" onClick={() => void buildPreview()}>{t('segment.generate')}</button><button data-role="primary" disabled={!preview.some((item) => item.parts.length > 1 && !item.blocked)} onClick={commit}>{t('edit.applyUndo')}</button></>}>
      <div className={styles.dialogTabs}>{(['manual', 'auto', 'advanced'] as const).map((item) => <button data-role="secondary" key={item} className={mode === item ? styles.activeTab : ''} onClick={() => { setMode(item); setPreview([]); }}>{item === 'manual' ? t('segment.manual') : item === 'auto' ? t('segment.auto') : t('segment.advanced')}</button>)}</div>
      {mode === 'manual' ? <div>
        <p>{t('segment.currentWord')}{activeWord?.text ?? t('segment.selectCanvas')}</p>
        <div className={styles.manualGraphemes} aria-label={t('segment.boundaries')}>{chars.map((char, index) => <span key={index}><span>{char}</span>{index < chars.length - 1 && <button data-role="secondary" aria-label={t('segment.boundary',{number:index+1})} aria-pressed={manualBoundaries.includes(index + 1)} onClick={() => {
          const next = manualBoundaries.includes(index + 1) ? manualBoundaries.filter((value) => value !== index + 1) : [...manualBoundaries, index + 1];
          setManualBoundaries(next);
          if (activeWord && manualLine) { const parts = manualParts(activeWord, next); setPreview([{ lineId: manualLine.id, word: activeWord, parts, blocked: parts.length > 1 && Boolean(activeWord.rubyUnits.length || activeWord.obscene || emptyBeatCount(editing, activeWord.id)) }]); }
        }}><Icon name={manualBoundaries.includes(index + 1) ? "sync-beat" : "sync-dot"}/></button>}</span>)}</div>
      </div> : <div className={styles.dialogControls}>
        <label>{t('edit.scope')}<Select value={scope} onChange={(event) => { setScope(event.target.value); setPreview([]); }}><option value="current">{t('edit.currentLine')}</option><option value="selected">{t('edit.selected')}</option><option value="range">{t('edit.lineRange')}</option><option value="all">{t('edit.allLines')}</option></Select></label>
        {scope === 'range' && <div className={styles.inlineFields}><label>{t('edit.fromLine')}<input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => { setFrom(Number(event.target.value)); setPreview([]); }} /> {t('edit.lineUnit')}</label><label>{t('edit.toLine')}<input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => { setTo(Number(event.target.value)); setPreview([]); }} /> {t('edit.lineUnit')}</label></div>}
        <label><input type="checkbox" checked={options.splitCjk} onChange={(event) => updateOption('splitCjk', event.target.checked)} /> {t('segment.cjk')}</label>
        <label>{t('segment.western')}<Select value={options.western} onChange={(event) => updateOption('western', event.target.value as SegmentOptions['western'])}><option value="word">{t('segment.words')}</option><option value="syllable">{t('segment.syllables')}</option></Select></label>
        {options.western === 'syllable' && <label>{t('segment.language')}<Select value={options.language} onChange={(event) => updateOption('language', event.target.value as SegmentOptions['language'])}>{SYLLABLE_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>}
        <label>{t('segment.punctuation')}<Select value={options.punctuation} onChange={(event) => updateOption('punctuation', event.target.value as SegmentOptions['punctuation'])}><option value="merge">{t('segment.adjacent')}</option><option value="separate">{t('segment.separate')}</option></Select></label>
        <label>{t('segment.whitespace')}<Select value={options.whitespace} onChange={(event) => updateOption('whitespace', event.target.value as SegmentOptions['whitespace'])}><option value="next">{t('segment.next')}</option><option value="previous">{t('segment.previous')}</option><option value="separate">{t('segment.keepSeparate')}</option></Select></label>
        {mode === 'advanced' && <>
          <label>{t('segment.weight')}<input type="number" min="0" step="0.1" value={options.punctuationWeight} onChange={(event) => updateOption('punctuationWeight', Number(event.target.value))} /></label>
          <label>{t('segment.ignore')}<textarea value={ignoreText} onChange={(event) => { setIgnoreText(event.target.value); setPreview([]); }} /></label>
          <label>{t('segment.rules')}<textarea value={ruleText} onChange={(event) => { setRuleText(event.target.value); setPreview([]); }} /></label>
          <label>{t('segment.testInput')}<input aria-label={t('segment.testInputLabel')} value={testInput} placeholder={t('segment.sample')} onChange={(event) => { setTestInput(event.target.value); setTestOutput([]); }} /></label>
          <button data-role="secondary" onClick={() => void testRule()}>{t('segment.testRules')}</button>
          {testOutput.length > 0 && <p>{t('segment.testResult')}<Parts parts={testOutput}/></p>}
        </>}
      </div>}

      {error && <p role="alert">{error}</p>}
      {preview.length > 0 && <div className={styles.segmentPreview}><strong>{t('segment.preview')}{preview.filter((item) => item.parts.length > 1 && !item.blocked).length} {t('segment.willSplit')}</strong>{preview.map((item) => <div key={item.word.id}><small>{lineText(document.lines.find((line) => line.id === item.lineId)!)}</small><span>{item.word.text} → <Parts parts={item.parts}/></span>{item.blocked && <em>{t('segment.keepRuby')}</em>}</div>)}</div>}
    </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
