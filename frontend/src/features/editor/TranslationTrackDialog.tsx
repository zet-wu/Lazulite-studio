import { lineLabel } from '../../domain/line-structure';
import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, translationText, type LyricDocument, type TranslationTrack } from '../../domain/lyric-document';
import { transferTranslations } from '../../domain/translation-editing';
import { SettingsDialog } from './SettingsDialog';
import { Select } from '../../shared/Select';
import { BooleanField, IconButton } from '../../shared/Controls';
import styles from './semantic-editor.module.css';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function shortReference(text: string): string {
  let prefix = '', count = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (count++ === 5) return `${prefix}…`;
    prefix += segment;
  }
  return prefix;
}

export const translationTrackLabel = (track: TranslationTrack, index: number) => `轨道 ${index + 1} · ${track.language ?? '未指定语言'} · ${track.purpose}`;
export function TranslationTrackDialog({ document, apply, close }: { document: LyricDocument; apply: (command: LyricCommand) => boolean; close: () => void }) {
  const [source] = useState(document);
  const [tracks, setTracks] = useState(source.translationTracks);
  const [selected, setSelected] = useState<string[]>([]), [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const stale = document !== source;
  const selectedIds = new Set(selected);
  const allIds = tracks.flatMap(track => track.contents.map(content => content.id));
  const sources = tracks.filter(track => track.id !== targetId);
  const movedCount = targetId ? sources.reduce((count, track) => count + track.contents.filter(content => selectedIds.has(content.id)).length, 0) : 0;
  const removedCount = targetId ? sources.filter(track => track.contents.length && track.contents.every(content => selectedIds.has(content.id))).length : 0;
  const selectAll = (ids: string[], checked: boolean) => setSelected(previous => checked ? [...new Set([...previous, ...ids])] : previous.filter(id => !ids.includes(id)));
  const selectionProps = (ids: string[]) => {
    const count = ids.filter(id => selectedIds.has(id)).length;
    return { checked: ids.length > 0 && count === ids.length, mixed: count > 0 && count < ids.length, disabled: !ids.length, onChange: (checked: boolean) => selectAll(ids, checked) };
  };
  const update = (track: TranslationTrack) => setTracks(items => items.map(item => item.id === track.id ? track : item));
  const addTrack = () => { const track: TranslationTrack = { id: crypto.randomUUID(), language: null, purpose: 'subtitle', contents: [] }; setTracks(items => [...items, track]); setTargetId(track.id); };
  return <SettingsDialog title="翻译轨道管理" close={close} actions={<><button data-role="secondary" onClick={close}>取消</button><button data-role="primary" disabled={stale} onClick={() => {
    try { if (apply({ type: 'set-translation-tracks', source: source.translationTracks, tracks })) close(); } catch (cause) { setError((cause as Error).message); }
  }}>应用</button></>}>
    <BooleanField label="全选内容" {...selectionProps(allIds)} />
    <div className={styles.trackManager}>{tracks.map((track, index) => <section className={styles.translationTrackSection} key={track.id}>
      <strong>{translationTrackLabel(track, index)}</strong>
      <label>语言 <input aria-label={`翻译轨道 ${index + 1}语言`} placeholder="未指定语言" value={track.language ?? ''} onChange={event => update({ ...track, language: event.target.value || null })} /></label>
      <button data-role="inline" onClick={() => update({ ...track, language: null })}>清除语言</button>
      <label>类型 <Select aria-label={`翻译轨道 ${index + 1}类型`} value={track.purpose} onChange={event => update({ ...track, purpose: event.target.value as TranslationTrack['purpose'] })}><option value="subtitle">subtitle</option><option value="replacement">replacement</option></Select></label>
      <small>{new Set(track.contents.map(content => content.lineId)).size} 行 · {track.contents.length} 份内容</small>
      {([-1, 1] as const).map(direction => <IconButton key={direction} icon={direction < 0 ? 'up' : 'down'} disabled={index + direction < 0 || index + direction >= tracks.length} label={`${direction < 0 ? '上移' : '下移'}翻译轨道 ${index + 1}`} onClick={() => { const next = tracks.slice(); [next[index], next[index + direction]] = [next[index + direction], next[index]]; setTracks(next); }} />)}
      <IconButton icon="trash" data-role="danger" label={`删除轨道及 ${track.contents.length} 份内容（轨道 ${index + 1}）`} onClick={() => {
        setTracks(items => items.filter(item => item.id !== track.id));
        setSelected(ids => ids.filter(id => !track.contents.some(content => content.id === id)));
        if (targetId === track.id) setTargetId('');
      }} />
      <BooleanField label="全选本轨内容" {...selectionProps(track.contents.map(content => content.id))} />
      <div className={styles.translationTrackContents}>{track.contents.map(content => {
        const line = source.lines.find(line => line.id === content.lineId)!;
        const body = lineText(line), translation = translationText(content);
        return <label key={content.id} className={styles.translationReference}>
          <input type="checkbox" aria-label={`选择翻译内容 ${content.id}`} aria-describedby={`translation-reference-${content.id}`} checked={selected.includes(content.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, content.id] : ids.filter(id => id !== content.id))} />
          <small>{lineLabel(source, line)}</small>
          <span className={styles.translationBody}>{shortReference(body)}</span>
          <span className={styles.translationText}>{shortReference(translation)}</span>
          <span id={`translation-reference-${content.id}`} className={styles.translationFull}>
            <span>正文</span><span className={styles.translationBody}>{body}</span>
            <span>翻译</span><span className={styles.translationText}>{translation}</span>
          </span>
        </label>;
      })}</div>
    </section>)}</div>
    <button data-role="secondary" onClick={addTrack}>新增翻译轨道</button>
    <fieldset><legend>内容归轨</legend><p>已选择 {selected.length} 份内容；实际转入 {movedCount} 份，将移除 {removedCount} 条本次搬空的源轨道。源轨道见各内容上方。文字、所属行及时间不变，语言和类型改用目标轨道属性；目标已有内容将保留，新内容追加到末尾。</p>
      <label>目标轨道 <Select aria-label="翻译归轨目标" value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">选择目标轨道</option>{tracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
      <button data-role="secondary" disabled={!movedCount || !tracks.some(track => track.id === targetId) || stale} onClick={() => { try { setTracks(transferTranslations({ ...source, translationTracks: tracks }, selected, targetId)); setSelected([]); } catch (cause) { setError((cause as Error).message); } }}>转入目标轨道</button>
    </fieldset>
    {(stale || error) && <p role="alert">{stale ? '文档已变化，请重新打开翻译轨道管理。' : error}</p>}
  </SettingsDialog>;
}
