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
import { selectIds } from './editing-actions';
import { SegmentWordDraft } from './SegmentWordDraft';
import { splitRubyWord } from '../../domain/segmentation-draft';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument, LyricWord } from '../../domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, loadSyllableDivider, segmentText, segmentationPreview, SYLLABLE_LANGUAGES, type SegmentOptions } from '../../domain/segmentation';
import styles from './semantic-editor.module.css';

function Parts({ parts }: { parts: string[] }) {
  useTranslation();
  return <span className={styles.segmentParts}>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <Icon name="sync-beat"/>}<span>{part}</span></Fragment>)}</span>;
}

type PreviewItem = { lineId: string; word: LyricWord; blocked: boolean; words: LyricWord[] };
type Props = { document: LyricDocument; wordIds: string[]; apply: (command: LyricCommand) => boolean; close: () => void; navigation?: ReactNode; scopeControl?: ReactNode; singleWord?: boolean };
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
  const [selection, setSelection] = useState<{sourceId: string; ids: string[]; anchorId: string} | null>(null);
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
  const [drafts, setDrafts] = useState<Record<string, LyricWord[]>>(() => {
    if (!singleWord) return {};
    const word = document.lines.flatMap(line=>line.words).find(word=>wordIds.includes(word.id));
    if (!word) return {};
    if (word.obscene || emptyBeatCount(editing, word.id)) return {};
    const parts = segmentText(word.text, DEFAULT_SEGMENT_OPTIONS);
    return {[word.id]: parts.length < 2 ? [word] : word.rubyUnits.length ? splitRubyWord(word, parts) : distributeSegmentTime(word, parts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight, editing)};
  });
  useEffect(() => setSelection(null), [mode, wordIds.join()]);
  const targets = document.lines.flatMap(line=>line.words.filter(word=>wordIds.includes(word.id)).map(word=>({lineId:line.id,word})));
  const blockedReason = (word: LyricWord) => [mode !== 'manual' && word.rubyUnits.length ? t('segment.blockRuby') : '', word.obscene ? t('segment.blockObscene') : '', emptyBeatCount(editing,word.id) ? t('segment.blockBeat') : ''].filter(Boolean).join(' · ');
  const preview: PreviewItem[] = mode === 'manual' ? targets.map(item => {
    const blocked = !!blockedReason(item.word), words = blocked ? [item.word] : drafts[item.word.id] ?? [item.word];
    return {...item, words, blocked};
  }) : result?.inputs === inputs ? result.items : [];
  const displayedLines = document.lines.filter(line => targets.some(item => item.lineId === line.id));
  const mainNumbers = new Map(document.lines.filter(line => !line.backgroundOf).map((line, index) => [line.id, index + 1]));
  const updateOption = <K extends keyof SegmentOptions>(key: K, value: SegmentOptions[K]) => setOptions(current => ({...current,[key]:value}));
  const testVersion = useRef(0);
  useEffect(() => { testVersion.current++; setTestOutput([]); return () => { testVersion.current++; }; }, [inputs, testInput]);
  const testRule = async () => {
    const version = ++testVersion.current;
    try {
      const config = { ...options, ignore: ignoreText.split('\n').map((item) => item.trim()).filter(Boolean), rules: parseRules(ruleText) };
      const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
      if (version !== testVersion.current) return;
      setTestOutput(segmentText(testInput, config, divide));
      setError('');
    } catch (cause) { if (version === testVersion.current) { setTestOutput([]); setError(errorMessage(cause)); } }
  };
  useEffect(() => {
    setError('');
    if (mode === 'manual') return;
    let active = true;
    if (composing) return;
    const timer = setTimeout(() => { void (async () => {
      try {
        const ids = wordIds;
        if (!ids.length) throw new MessageError(describeMessage('segment.noWords'));
        const config = mode === 'advanced' ? { ...options, ignore: ignoreText.split('\n').map(item => item.trim()).filter(Boolean), rules: parseRules(ruleText) } : { ...options, punctuationWeight: DEFAULT_SEGMENT_OPTIONS.punctuationWeight, ignore: [], rules: [] };
        const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
        const items = segmentationPreview(document, ids, config, divide, editing).map(({lineId, word, blocked, parts}) => ({lineId, word, blocked, words: blocked ? [word] : distributeSegmentTime(word, parts, config.punctuationWeight, editing)}));
        if (active) setResult({ inputs, items });
      } catch (cause) { if (active) { setResult(null); setError(errorMessage(cause)); } }
    })(); }, mode === 'advanced' ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [inputs]);
  const commit = () => {
    try {
      const changed = preview.filter((item) => item.words.length > 1 && !item.blocked);
      if (!changed.length) return;
      const changes = changed.map((item) => ({ lineId: item.lineId, wordId: item.word.id,
        words: item.words }));
      if (apply({ type: 'segment-words', changes })) close();
    } catch (cause) { setError(errorMessage(cause)); }
  };
  return <SettingsDialog title={t(singleWord ? 'editor.splitWord' : 'batch.title')} close={close} actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button>{mode !== 'manual' && error && <button data-role="secondary" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button>}<button data-role="primary" disabled={composing || !preview.some((item) => item.words.length > 1 && !item.blocked)} onClick={commit}>{t('edit.applyUndo')}</button></>}>
      {navigation}
      {!singleWord && <SettingField label={t('segment.mode')}><Select value={mode} onChange={event=>setMode(event.target.value as typeof mode)}>{(['manual','auto','advanced'] as const).map(value=><option key={value} value={value}>{t(`segment.${value}`)}</option>)}</Select></SettingField>}
      {scopeControl}
      {!targets.length && <p role="status">{t('segment.noWords')}</p>}
      {mode !== 'manual' && <div className={fields.group}>
        <SettingToggle label={t('segment.cjk')} checked={options.splitCjk} onChange={value=>updateOption('splitCjk',value)}/>
        <SettingToggle label={t('segment.japaneseMora')} checked={options.japaneseMora} disabled={!options.splitCjk} onChange={value=>updateOption('japaneseMora',value)}/>
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
      {mode !== 'manual' && result?.inputs !== inputs && !error && <p role="status">{t('segment.computing')}</p>}
      <div className={styles.segmentManual}>{displayedLines.map(line => <section key={line.id}>
        {displayedLines.length > 1 && <h3>{`L${mainNumbers.get(line.backgroundOf ?? line.id)}`}{line.backgroundOf && ` · ${t('editor.background')}`}</h3>}
        <div className={styles.segmentLine}>{line.words.filter(word => !singleWord || wordIds.includes(word.id)).map(word => {
          const item = preview.find(item => item.word.id === word.id), target = wordIds.includes(word.id);
          return <SegmentWordDraft key={word.id} source={word} words={item?.words ?? [word]} editable={mode === 'manual' && target && !blockedReason(word)} reason={target ? blockedReason(word) : ''}
            selected={selection?.sourceId === word.id ? selection.ids : []} clearSelection={() => setSelection(null)}
            select={(id, shift = false, toggle = false, preserve = false) => setSelection(current => {
              const previous = current?.sourceId === word.id ? current : null;
              if (preserve && previous?.ids.includes(id)) return previous;
              return {sourceId: word.id, ids: selectIds(word.rubyUnits.map(unit => unit.id), previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle), anchorId: shift || toggle ? previous?.anchorId ?? id : id};
            })} change={words => setDrafts(previous => ({...previous, [word.id]: words}))}/>;
        })}</div>
      </section>)}</div>
    </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
