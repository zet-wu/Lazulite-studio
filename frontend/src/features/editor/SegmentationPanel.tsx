import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage, MessageError } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/Icon';
import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { SettingField, SettingToggle } from '../../shared/SettingsFields';
import fields from '../../shared/settings-fields.module.css';
import { SettingsDialog } from './SettingsDialog';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, type LyricDocument, type LyricWord } from '../../domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, loadSyllableDivider, segmentText, segmentationPreview, SYLLABLE_LANGUAGES, type SegmentOptions } from '../../domain/segmentation';
import styles from './semantic-editor.module.css';

function Parts({ parts }: { parts: string[] }) {
  useTranslation();
  return <span className={styles.segmentParts}>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <Icon name="sync-beat"/>}<span>{part}</span></Fragment>)}</span>;
}

type PreviewItem = ReturnType<typeof segmentationPreview>[number];
type Props = { document: LyricDocument; wordIds: string[]; apply: (command: LyricCommand) => boolean; close: () => void; navigation?: ReactNode; scopeControl?: ReactNode; singleWord?: boolean };
export const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
export function boundaryParts(text: string, boundaries: number[]) {
  const chars = graphemes(text);
  return [0, ...boundaries.filter(n => n > 0 && n < chars.length).sort((a,b) => a-b), chars.length]
    .flatMap((end, index, points) => index ? [chars.slice(points[index-1], end).join('')] : []);
}
function BoundaryEditor({word, boundaries, disabled, change}: {word: LyricWord; boundaries: number[]; disabled: boolean; change: (next: number[]) => void}) {
  const chars = graphemes(word.text);
  return <div className={styles.manualGraphemes} aria-label={t('segment.boundaries')}>{chars.map((char, index) => <span key={index}><span>{char}</span>{index < chars.length-1 && <button data-role="inline" disabled={disabled} aria-label={t('segment.boundary',{number:index+1})} aria-pressed={boundaries.includes(index+1)} onClick={() => change(boundaries.includes(index+1) ? boundaries.filter(n=>n!==index+1) : [...boundaries,index+1])}><Icon name={boundaries.includes(index+1) ? 'sync-beat' : 'sync-dot'}/></button>}</span>)}</div>;
}

function parseRules(input: string): SegmentOptions['rules'] {
  return input.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new MessageError(describeMessage('segment.ruleSyntax',{rule:line}));
    return { source: line.slice(0, separator).trim(), parts: line.slice(separator + 1).split('|').map((part) => part.trim()) };
  });
}

export function SegmentationPanel({ document, wordIds, apply, close, navigation, scopeControl, singleWord = false }: Props) {
  useTranslation();
  const editing = useProjectEditing();
  const [mode, setMode] = useState<'manual' | 'auto' | 'advanced'>('manual');
  const [options, setOptions] = useState<SegmentOptions>(DEFAULT_SEGMENT_OPTIONS);
  const [ignoreText, setIgnoreText] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputs = useMemo(() => ({}), [document, wordIds.join(), options, ignoreText, ruleText, mode, editing, composing, retry]);
  const [result, setResult] = useState<{ inputs: object; items: PreviewItem[] } | null>(null);
  const [error, setError] = useMessageText('');
  const [drafts, setDrafts] = useState<Record<string, number[]>>(() => {
    if (!singleWord) return {};
    const word = document.lines.flatMap(line=>line.words).find(word=>wordIds.includes(word.id));
    if (!word) return {};
    let offset = 0;
    return {[word.id]: segmentText(word.text, DEFAULT_SEGMENT_OPTIONS).slice(0,-1).map(part => (offset += graphemes(part).length))};
  });
  const targets = document.lines.flatMap(line=>line.words.filter(word=>wordIds.includes(word.id)).map(word=>({lineId:line.id,word})));
  const blockedReason = (word: LyricWord) => [word.rubyUnits.length ? t('segment.blockRuby') : '', word.obscene ? t('segment.blockObscene') : '', emptyBeatCount(editing,word.id) ? t('segment.blockBeat') : ''].filter(Boolean).join(' · ');
  const preview = mode === 'manual' ? targets.map(item=>({...item,parts:boundaryParts(item.word.text,drafts[item.word.id] ?? []),blocked:!!blockedReason(item.word)})) : result?.inputs === inputs ? result.items : [];
  const updateOption = <K extends keyof SegmentOptions>(key: K, value: SegmentOptions[K]) => setOptions(current => ({...current,[key]:value}));
  const testRule = async () => {
    try {
      const config = { ...options, ignore: ignoreText.split('\n').map((item) => item.trim()).filter(Boolean), rules: parseRules(ruleText) };
      const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
      setTestOutput(segmentText(testInput, config, divide));
      setError('');
    } catch (cause) { setTestOutput([]); setError(errorMessage(cause)); }
  };
  useEffect(() => {
    if (mode === 'manual') return;
    let active = true;
    setError('');
    if (composing) return;
    const timer = setTimeout(() => { void (async () => {
      try {
        const ids = wordIds;
        if (!ids.length) throw new MessageError(describeMessage('segment.noWords'));
        const config = mode === 'advanced' ? { ...options, ignore: ignoreText.split('\n').map(item => item.trim()).filter(Boolean), rules: parseRules(ruleText) } : { ...options, punctuationWeight: DEFAULT_SEGMENT_OPTIONS.punctuationWeight, ignore: [], rules: [] };
        const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
        const items = segmentationPreview(document, ids, config, divide, editing);
        if (active) setResult({ inputs, items });
      } catch (cause) { if (active) { setResult(null); setError(errorMessage(cause)); } }
    })(); }, mode === 'advanced' ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [inputs]);
  const commit = () => {
    try {
      const changed = preview.filter((item) => item.parts.length > 1 && !item.blocked);
      if (!changed.length) return;
      const changes = changed.map((item) => ({ lineId: item.lineId, wordId: item.word.id,
        words: distributeSegmentTime(item.word, item.parts, mode === 'advanced' ? options.punctuationWeight : DEFAULT_SEGMENT_OPTIONS.punctuationWeight, editing) }));
      if (apply({ type: 'segment-words', changes })) close();
    } catch (cause) { setError(errorMessage(cause)); }
  };
  return <SettingsDialog title={t(singleWord ? 'editor.splitWord' : 'batch.title')} close={close} actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button>{mode !== 'manual' && error && <button data-role="secondary" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button>}<button data-role="primary" disabled={composing || !preview.some((item) => item.parts.length > 1 && !item.blocked)} onClick={commit}>{t('edit.applyUndo')}</button></>}>
      {navigation}
      {!singleWord && <SettingField label={t('segment.mode')}><Select value={mode} onChange={event=>setMode(event.target.value as typeof mode)}>{(['manual','auto','advanced'] as const).map(value=><option key={value} value={value}>{t(`segment.${value}`)}</option>)}</Select></SettingField>}
      {scopeControl}
      {!targets.length && <p role="status">{t('segment.noWords')}</p>}
      {mode === 'manual' ? <div className={styles.segmentManual}>{document.lines.map((line,index) => {
        const words = targets.filter(item=>item.lineId===line.id);
        return words.length ? <section key={line.id}><h3>{t('split.lineNumber',{number:index+1})}{line.backgroundOf && ` · ${t('editor.background')} (${document.lines.findIndex(parent=>parent.id===line.backgroundOf)+1})`}</h3><p className={styles.lyricQuote}>{lineText(line)}</p>{words.map(({word})=><div className={styles.segmentWord} key={word.id}><strong className={styles.lyricQuote}>{word.text}</strong><BoundaryEditor word={word} boundaries={drafts[word.id] ?? []} disabled={!!blockedReason(word)} change={next=>setDrafts(previous=>({...previous,[word.id]:next}))}/>{blockedReason(word) && <p className={styles.toolHint}>{blockedReason(word)}</p>}</div>)}</section> : null;
      })}</div> : <div className={fields.group}>
        <SettingToggle label={t('segment.cjk')} checked={options.splitCjk} onChange={value=>updateOption('splitCjk',value)}/>
        <SettingField label={t('segment.western')}><Select value={options.western} onChange={(event) => updateOption('western', event.target.value as SegmentOptions['western'])}><option value="word">{t('segment.words')}</option><option value="syllable">{t('segment.syllables')}</option></Select></SettingField>
        {options.western === 'syllable' && <SettingField label={t('segment.language')}><Select value={options.language} onChange={(event) => updateOption('language', event.target.value as SegmentOptions['language'])}>{SYLLABLE_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></SettingField>}
        <SettingField label={t('segment.punctuation')}><Select value={options.punctuation} onChange={(event) => updateOption('punctuation', event.target.value as SegmentOptions['punctuation'])}><option value="merge">{t('segment.adjacent')}</option><option value="separate">{t('segment.separate')}</option></Select></SettingField>
        <SettingField label={t('segment.whitespace')}><Select value={options.whitespace} onChange={(event) => updateOption('whitespace', event.target.value as SegmentOptions['whitespace'])}><option value="next">{t('segment.next')}</option><option value="previous">{t('segment.previous')}</option><option value="separate">{t('segment.keepSeparate')}</option></Select></SettingField>
        {mode === 'advanced' && <>
          <SettingField label={t('segment.weight')}><input type="number" min="0" step="0.1" value={options.punctuationWeight} onChange={(event) => updateOption('punctuationWeight', Number(event.target.value))} /></SettingField>
          <SettingField label={t('segment.ignore')} stacked><textarea onKeyDown={event => { if (composing) event.stopPropagation(); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} value={ignoreText} onChange={(event) => { setIgnoreText(event.target.value); }} /></SettingField>
          <SettingField label={t('segment.rules')} stacked><textarea onKeyDown={event => { if (composing) event.stopPropagation(); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} value={ruleText} onChange={(event) => { setRuleText(event.target.value); }} /></SettingField>
          <SettingField label={t('segment.testInput')}><input aria-label={t('segment.testInputLabel')} value={testInput} placeholder={t('segment.sample')} onChange={(event) => { setTestInput(event.target.value); setTestOutput([]); }} /></SettingField>
          <button data-role="secondary" onClick={() => void testRule()}>{t('segment.testRules')}</button>
          {testOutput.length > 0 && <p>{t('segment.testResult')}<Parts parts={testOutput}/></p>}
        </>}
      </div>}

      {error && <p role="alert">{error}</p>}
      <p role="status">{t('segment.summary',{lines:new Set(targets.map(item=>item.lineId)).size,words:targets.length,split:preview.filter(item=>item.parts.length>1&&!item.blocked).length,blocked:targets.filter(item=>blockedReason(item.word)).length})}</p>
      {preview.length > 0 && <div className={styles.segmentPreview}><strong>{t('segment.preview')}{preview.filter((item) => item.parts.length > 1 && !item.blocked).length} {t('segment.willSplit')}</strong>{preview.map((item) => <div key={item.word.id}><small title={lineText(document.lines.find((line) => line.id === item.lineId)!)}>{lineText(document.lines.find((line) => line.id === item.lineId)!)}</small><span>{item.word.text} → <Parts parts={item.parts}/></span>{item.blocked && <em>{blockedReason(item.word)}</em>}</div>)}</div>}
    </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
