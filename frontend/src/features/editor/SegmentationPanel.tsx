import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Select } from '../../shared/Select';
import { SettingsDialog } from './SettingsDialog';
import { useEffect, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, type LyricDocument, type LyricWord } from '../../domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, loadSyllableDivider, segmentText, segmentationPreview, SYLLABLE_LANGUAGES, type SegmentOptions } from '../../domain/segmentation';
import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

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
    if (separator < 1) throw new Error(`规则需写成 原文=部分|部分：${line}`);
    return { source: line.slice(0, separator).trim(), parts: line.slice(separator + 1).split('|').map((part) => part.trim()) };
  });
}

export function SegmentationPanel({ document, selection, currentLineId, apply, close }: Props) {
  const editing = useProjectEditing();
  const [mode, setMode] = useState<'manual' | 'auto' | 'advanced'>('manual');
  const [scope, setScope] = useState('current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(document.lines.length);
  const [options, setOptions] = useState<SegmentOptions>(DEFAULT_SEGMENT_OPTIONS);
  const [ignoreText, setIgnoreText] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [error, setError] = useState('');
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
      setTestOutput(segmentText(testInput, config, divide).join(' │ '));
      setError('');
    } catch (cause) { setTestOutput(''); setError(cause instanceof Error ? cause.message : '测试失败'); }
  };
  const buildPreview = async () => {
    try {
      setError('');
      if (mode === 'manual') {
        if (!activeWord || !manualLine) throw new Error('请先选择一个词');
        const parts = manualParts(activeWord);
        setPreview([{ lineId: manualLine.id, word: activeWord, parts, blocked: parts.length > 1 && Boolean(activeWord.rubyUnits.length || activeWord.obscene || emptyBeatCount(editing, activeWord.id)) }]);
        return;
      }
      const ids = targetWordIds(document, selection, currentLineId, scope, from, to);
      if (!ids.length) throw new Error('所选范围没有歌词词块');
      const config = { ...options, ignore: ignoreText.split('\n').map((item) => item.trim()).filter(Boolean), rules: parseRules(ruleText) };
      const divide = config.western === 'syllable' ? await loadSyllableDivider(config.language) : undefined;
      setPreview(segmentationPreview(document, ids, config, divide, editing));
    } catch (cause) { setPreview([]); setError(cause instanceof Error ? cause.message : '分词预览失败'); }
  };
  const commit = () => {
    try {
      const changed = preview.filter((item) => item.parts.length > 1 && !item.blocked);
      if (!changed.length) return;
      const changes = changed.map((item) => ({ lineId: item.lineId, wordId: item.word.id,
        words: distributeSegmentTime(item.word, item.parts, options.punctuationWeight, editing) }));
      if (apply({ type: 'segment-words', changes })) close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '应用分词失败'); }
  };
  return <SettingsDialog title="分词" close={close} actions={<><button data-role="secondary" onClick={() => void buildPreview()}>生成预览</button><button data-role="primary" disabled={!preview.some((item) => item.parts.length > 1 && !item.blocked)} onClick={commit}>应用（一次撤销）</button></>}>
      <div className={styles.dialogTabs}>{(['manual', 'auto', 'advanced'] as const).map((item) => <button data-role="secondary" key={item} className={mode === item ? styles.activeTab : ''} onClick={() => { setMode(item); setPreview([]); }}>{item === 'manual' ? '手动' : item === 'auto' ? '自动' : '高级'}</button>)}</div>
      {mode === 'manual' ? <div>
        <p>当前词：{activeWord?.text ?? '请在画布选择一个词'}</p>
        <div className={styles.manualGraphemes} aria-label="字符切分边界">{chars.map((char, index) => <span key={index}><span>{char}</span>{index < chars.length - 1 && <button data-role="secondary" aria-label={`切分边界 ${index + 1}`} aria-pressed={manualBoundaries.includes(index + 1)} onClick={() => {
          const next = manualBoundaries.includes(index + 1) ? manualBoundaries.filter((value) => value !== index + 1) : [...manualBoundaries, index + 1];
          setManualBoundaries(next);
          if (activeWord && manualLine) { const parts = manualParts(activeWord, next); setPreview([{ lineId: manualLine.id, word: activeWord, parts, blocked: parts.length > 1 && Boolean(activeWord.rubyUnits.length || activeWord.obscene || emptyBeatCount(editing, activeWord.id)) }]); }
        }}>{manualBoundaries.includes(index + 1) ? '│' : '·'}</button>}</span>)}</div>
      </div> : <div className={styles.dialogControls}>
        <label>应用范围<Select value={scope} onChange={(event) => { setScope(event.target.value); setPreview([]); }}><option value="current">当前行</option><option value="selected">选中词或行</option><option value="range">指定行范围</option><option value="all">全文</option></Select></label>
        {scope === 'range' && <div className={styles.inlineFields}><label>从第 <input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => { setFrom(Number(event.target.value)); setPreview([]); }} /> 行</label><label>到第 <input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => { setTo(Number(event.target.value)); setPreview([]); }} /> 行</label></div>}
        <label><input type="checkbox" checked={options.splitCjk} onChange={(event) => updateOption('splitCjk', event.target.checked)} /> CJK 按字符切分</label>
        <label>西文处理<Select value={options.western} onChange={(event) => updateOption('western', event.target.value as SegmentOptions['western'])}><option value="word">按词</option><option value="syllable">按语言音节</option></Select></label>
        {options.western === 'syllable' && <label>音节语言<Select value={options.language} onChange={(event) => updateOption('language', event.target.value as SegmentOptions['language'])}>{SYLLABLE_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>}
        <label>标点<Select value={options.punctuation} onChange={(event) => updateOption('punctuation', event.target.value as SegmentOptions['punctuation'])}><option value="merge">并入相邻词</option><option value="separate">独立</option></Select></label>
        <label>空白<Select value={options.whitespace} onChange={(event) => updateOption('whitespace', event.target.value as SegmentOptions['whitespace'])}><option value="next">并入后词</option><option value="previous">并入前词</option><option value="separate">独立保留</option></Select></label>
        {mode === 'advanced' && <>
          <label>标点时间权重<input type="number" min="0" step="0.1" value={options.punctuationWeight} onChange={(event) => updateOption('punctuationWeight', Number(event.target.value))} /></label>
          <label>忽略列表（每行一个）<textarea value={ignoreText} onChange={(event) => { setIgnoreText(event.target.value); setPreview([]); }} /></label>
          <label>自定义规则（每行 原文=部分|部分）<textarea value={ruleText} onChange={(event) => { setRuleText(event.target.value); setPreview([]); }} /></label>
          <label>测试输入<input aria-label="分词测试输入" value={testInput} placeholder="输入任意短句" onChange={(event) => { setTestInput(event.target.value); setTestOutput(''); }} /></label>
          <button data-role="secondary" onClick={() => void testRule()}>测试规则</button>
          {testOutput && <p>测试结果：{testOutput}</p>}
        </>}
      </div>}

      {error && <p role="alert">{error}</p>}
      {preview.length > 0 && <div className={styles.segmentPreview}><strong>预览：{preview.filter((item) => item.parts.length > 1 && !item.blocked).length} 词将切分</strong>{preview.map((item) => <div key={item.word.id}><small>{lineText(document.lines.find((line) => line.id === item.lineId)!)}</small><span>{item.word.text} → {item.parts.join(' │ ')}</span>{item.blocked && <em>含 注音 或附属属性，保留原词</em>}</div>)}</div>}
    </SettingsDialog>;
}
