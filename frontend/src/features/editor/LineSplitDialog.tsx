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
  submit: (beforeWordId: string, contentIdsForNewLine: string[], backgroundTarget: 'left' | 'right' | null) => boolean;
}) {
  const [beforeWordId, setBeforeWordId] = useState(line.words[1]?.id ?? '');
  const [rightIds, setRightIds] = useState<string[]>([]);
  const [backgroundTarget, setBackgroundTarget] = useState<'left' | 'right'>('right');
  const boundary = line.words.findIndex((word) => word.id === beforeWordId);
  return <SettingsDialog title="拆分歌词行" close={close} actions={<><button onClick={close}>取消</button><button disabled={!beforeWordId} onClick={() => { if (submit(beforeWordId, rightIds, background ? backgroundTarget : null)) close(); }}>应用（一次撤销）</button></>}>
      <label>从该词开始新行 <select autoFocus value={beforeWordId} onChange={(event) => setBeforeWordId(event.target.value)}>
        {line.words.slice(1).map((word, index) => <option key={word.id} value={word.id}>{index + 2} · {word.text}</option>)}
      </select></label>
      <p>左：{line.words.slice(0, boundary).map((word) => word.text).join('')}　右：{line.words.slice(boundary).map((word) => word.text).join('')}</p>
      {attached.length > 0 && <fieldset><legend>音译内容归属</legend>{attached.map(({ track, content }) => <label key={content.id} className={styles.splitAssignment}>
        <span>{track.language ?? '未指定语言'} · {content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}</span>
        <select value={rightIds.includes(content.id) ? 'right' : 'left'} onChange={(event) => setRightIds((ids) => event.target.value === 'right' ? [...ids, content.id] : ids.filter((id) => id !== content.id))}>
          <option value="left">左行</option><option value="right">右行</option>
        </select>
      </label>)}</fieldset>}
      {background && <label>背景歌词「{lineText(background)}」归属 <select value={backgroundTarget} onChange={(event) => setBackgroundTarget(event.target.value as 'left' | 'right')}><option value="left">左行</option><option value="right">右行</option></select></label>}
      <p>音译文字与时间保持原值；拆分只改变所属主行。</p>

    </SettingsDialog>;
}
