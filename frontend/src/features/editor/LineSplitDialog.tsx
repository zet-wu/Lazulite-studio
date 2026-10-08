import { useState } from 'react';
import { translationText, lineText, type LyricLine, type TranslationContent, type RomanizationContent, type RomanizationTrack } from '../../domain/lyric-document';
import { previewLineSplit, type LineSplitPlan } from '../../domain/lyric-commands';
import { Select } from '../../shared/Select';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

type Attached = { track: RomanizationTrack; content: RomanizationContent };
export function LineSplitDialog({ line, translations, backgrounds, attached, close, submit }: {
  line: LyricLine; translations: TranslationContent[]; backgrounds: LyricLine[]; attached: Attached[];
  close: () => void; submit: (plan: LineSplitPlan) => boolean;
}) {
  const [cuts, setCuts] = useState<string[]>([]);
  // Segment identity is its first original word, so deleting a boundary cannot silently move an assignment.
  const first = line.words[0].id;
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [backgroundKeys, setBackgroundKeys] = useState<Record<string,string>>({});
  const preview = cuts.length ? previewLineSplit(line, cuts) : [{ segment: line, issue: null }];
  const keys = preview.map(({ segment }) => segment.words[0].id);
  const bgKey = (id: string) => backgroundKeys[id] ?? keys.at(-1)!;
  const entries = [...translations.map(content => ({ id: content.id, label: '翻译', text: translationText(content) })),
    ...attached.map(({ content, track }) => ({ id: content.id, label: `音译 ${track.language ?? '未指定语言'}`, text: content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('') }))];
  const invalid = entries.some(item => !keys.includes(targets[item.id] ?? first)) || backgrounds.some(bg=>!keys.includes(bgKey(bg.id)));
  const time = (value: number | null) => value === null ? '未定' : `${(value / 1000).toFixed(3)}s`;
  const options = <><option value="" disabled>请重新选择归属</option>{keys.map((key, i) => <option key={key} value={key}>第 {i + 1} 行</option>)}</>;
  return <SettingsDialog title="拆分歌词行" close={close} actions={<>
    <button data-role="secondary" onClick={close}>取消</button>
    <button data-role="primary" disabled={!cuts.length || invalid || preview.some(item => item.issue)} onClick={() => {
      const plan: LineSplitPlan = { lineId: line.id, beforeWordIds: cuts, newLineIds: keys.slice(1).map(() => crypto.randomUUID()),
        translationTargets: Object.fromEntries(translations.map(item => [item.id, keys.indexOf(targets[item.id] ?? first)])),
        contentTargets: Object.fromEntries(attached.map(({ content }) => [content.id, keys.indexOf(targets[content.id] ?? first)])),
        backgroundTargets:Object.fromEntries(backgrounds.map(bg=>[bg.id,keys.indexOf(bgKey(bg.id))])) };
      if (submit(plan)) close();
    }}>应用</button>
  </>}>
    <p>点击词间边界添加或取消切点。</p>
    <div className={styles.manualGraphemes} aria-label="拆行切点">{line.words.map((word, index) => <span key={word.id}>
      {index > 0 && <button data-role="inline" aria-label={`在第 ${index + 1} 词前切分`} aria-pressed={cuts.includes(word.id)} onClick={() => {
        const next = cuts.includes(word.id) ? cuts.filter(id => id !== word.id) : [...cuts, word.id];
        if(cuts.includes(word.id)) setBackgroundKeys(previous=>Object.fromEntries(backgrounds.map(bg=>[bg.id,previous[bg.id] ?? bgKey(bg.id)])));
        setCuts(next);
      }}>|</button>}
      <strong className={styles.splitWord}>{word.text}</strong>
    </span>)}</div>
    {invalid && <p role="alert">切点已改变，原归属行不再存在，请重新选择归属。</p>}
    <div className={styles.splitPreview} aria-label="拆分结果">{preview.map(({ segment, issue }, index) => <section key={keys[index]}>
      <small>第 {index + 1} 行 · {time(segment.beginMs)} – {time(segment.endMs)}</small>
      <p>{lineText(segment)}</p>
      {issue && <p role="alert">{issue}</p>}
      {entries.filter(item => (targets[item.id] ?? first) === keys[index]).map(item => <small key={item.id}>{item.label} · <strong>{item.text}</strong></small>)}
      {backgrounds.filter(bg=>bgKey(bg.id)===keys[index]).map(bg=><small key={bg.id}>背景 · <strong>{lineText(bg)}</strong></small>)}
    </section>)}</div>
    {entries.map((item, index) => <label key={item.id} className={styles.splitAssignment}>
      <span>{item.label} · <strong>{item.text}</strong></span>
      <Select aria-label={`${item.label} ${index + 1}归属`} value={keys.includes(targets[item.id] ?? first) ? targets[item.id] ?? first : ''}
        onChange={event => setTargets(previous => ({ ...previous, [item.id]: event.target.value }))}>{options}</Select>
    </label>)}
    {backgrounds.map((background,i) => <label key={background.id} className={styles.splitAssignment}><span>背景 · <strong>{lineText(background)}</strong></span>
      <Select aria-label={`背景歌词${backgrounds.length>1 ? ` ${i+1}` : ''}归属`} value={keys.includes(bgKey(background.id)) ? bgKey(background.id) : ''} onChange={event => setBackgroundKeys(previous=>({...previous,[background.id]:event.target.value}))}>{options}</Select>
    </label>)}
  </SettingsDialog>;
}
