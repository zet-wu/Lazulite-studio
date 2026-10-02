import { SettingsDialog } from './SettingsDialog';
import { useState } from 'react';
import type { LyricLine, RomanizationContent, RomanizationTrack } from '../../domain/lyric-document';
import { lineText } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

type Attached = { track: RomanizationTrack; content: RomanizationContent };

export function LineSplitDialog({ line, background, attached, close, submit }: {
  line: LyricLine;
  background: LyricLine | null;
  attached: Attached[];
  close: () => void;
  submit: (beforeWordId: string, contentIdsForNewLine: string[], backgroundTarget: 'left' | 'right' | null, translationIndicesForNewLine: number[]) => boolean;
}) {
  const [beforeWordId, setBeforeWordId] = useState(line.words[1]?.id ?? '');
  const [rightTranslations, setRightTranslations] = useState<number[]>([]);
  const [rightIds, setRightIds] = useState<string[]>([]);
  const [backgroundTarget, setBackgroundTarget] = useState<'left' | 'right'>('right');
  const boundary = line.words.findIndex((word) => word.id === beforeWordId);
  return <SettingsDialog title="拆分歌词行" close={close} actions={<><button data-role="secondary" onClick={close}>取消</button><button data-role="primary" disabled={!beforeWordId} onClick={() => { if (submit(beforeWordId, rightIds, background ? backgroundTarget : null, rightTranslations)) close(); }}>应用</button></>}>
      <label>从该词开始新行 <select autoFocus value={beforeWordId} onChange={(event) => setBeforeWordId(event.target.value)}>
        {line.words.slice(1).map((word, index) => <option key={word.id} value={word.id}>{index + 2} · {word.text}</option>)}
      </select></label>
      <div className={styles.splitPreview} aria-label="拆分结果">{[false, true].map(isRight => {
        const words = isRight ? line.words.slice(boundary) : line.words.slice(0, boundary);
        const end = isRight ? line.endMs : words.every(word => word.endMs !== null) ? Math.max(...words.map(word => word.endMs!)) : null;
        const begin = isRight ? words[0]?.beginMs ?? null : line.beginMs;
        const time = (value: number | null) => value === null ? '未定' : `${(value / 1e3).toFixed(3)}s`;
        return <section key={String(isRight)}><small>{isRight ? '后行' : '前行'} · {time(begin)} – {time(end)}</small>
          <p>{words.map(word => word.text).join('')}</p>
          {line.translations.filter((_, index) => rightTranslations.includes(index) === isRight).map((item, index) => <small key={index}>{item.language ?? '未指定语言'} · {item.text}</small>)}
          {attached.filter(({ content }) => rightIds.includes(content.id) === isRight).map(({ content, track }) => <small key={content.id}>{track.language ?? '未指定语言'} · {content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('')}</small>)}
          {background && (backgroundTarget === 'right') === isRight && <small>背景 · {lineText(background)}</small>}
        </section>;
      })}</div>
      {line.translations.length > 0 && <fieldset><legend>翻译归属</legend>{line.translations.map((item, index) => <label key={index} className={styles.splitAssignment}>
        <span>{item.language ?? '未指定语言'} · {item.text}</span>
        <select aria-label={`翻译 ${index + 1}归属`} value={rightTranslations.includes(index) ? 'right' : 'left'} onChange={event => setRightTranslations(indices => event.target.value === 'right' ? [...indices, index] : indices.filter(i => i !== index))}>
          <option value="left">前行</option><option value="right">后行</option>
        </select>
      </label>)}</fieldset>}
      {attached.length > 0 && <fieldset><legend>音译内容归属</legend>{attached.map(({ track, content }) => <label key={content.id} className={styles.splitAssignment}>
        <span>{track.language ?? '未指定语言'} · {content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}</span>
        <select value={rightIds.includes(content.id) ? 'right' : 'left'} onChange={(event) => setRightIds((ids) => event.target.value === 'right' ? [...ids, content.id] : ids.filter((id) => id !== content.id))}>
          <option value="left">前行</option><option value="right">后行</option>
        </select>
      </label>)}</fieldset>}
      {background && <label>背景歌词「{lineText(background)}」归属 <select value={backgroundTarget} onChange={(event) => setBackgroundTarget(event.target.value as 'left' | 'right')}><option value="left">前行</option><option value="right">后行</option></select></label>}


    </SettingsDialog>;
}
