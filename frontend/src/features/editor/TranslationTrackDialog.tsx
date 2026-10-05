import { lineLabel } from '../../domain/line-structure';
import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, translationText, type LyricDocument, type TranslationTrack } from '../../domain/lyric-document';
import { transferTranslations } from '../../domain/translation-editing';
import { SettingsDialog } from './SettingsDialog';
import { Select } from '../../shared/Select';
import { IconButton } from '../../shared/Controls';
import styles from './semantic-editor.module.css';

export const translationTrackLabel = (track: TranslationTrack, index: number) => `轨道 ${index + 1} · ${track.language ?? '未指定语言'} · ${track.purpose === 'subtitle' ? '字幕' : '替换文字'}`;
export function TranslationTrackDialog({ document, apply, close }: { document: LyricDocument; apply: (command: LyricCommand) => boolean; close: () => void }) {
  const [source] = useState(document);
  const [tracks, setTracks] = useState(source.translationTracks);
  const [selected, setSelected] = useState<string[]>([]), [targetId, setTargetId] = useState('');
  const [error, setError] = useState(''), [deleting, setDeleting] = useState<string | null>(null);
  const stale = document !== source;
  const update = (track: TranslationTrack) => setTracks(items => items.map(item => item.id === track.id ? track : item));
  const addTrack = () => { const track: TranslationTrack = { id: crypto.randomUUID(), language: null, purpose: 'subtitle', contents: [] }; setTracks(items => [...items, track]); setTargetId(track.id); };
  return <SettingsDialog title="翻译轨道管理" close={close} actions={<><button data-role="secondary" onClick={close}>取消</button><button data-role="primary" disabled={stale} onClick={() => {
    try { if (apply({ type: 'set-translation-tracks', source: source.translationTracks, tracks })) close(); } catch (cause) { setError((cause as Error).message); }
  }}>应用</button></>}>
    <div className={styles.trackManager}>{tracks.map((track, index) => <section className={styles.translationTrackSection} key={track.id}>
      <strong>{translationTrackLabel(track, index)}</strong>
      <label>语言 <input aria-label={`翻译轨道 ${index + 1}语言`} placeholder="未指定语言" value={track.language ?? ''} onChange={event => update({ ...track, language: event.target.value || null })} /></label>
      <button data-role="inline" onClick={() => update({ ...track, language: null })}>清除语言</button>
      <label>用途 <Select aria-label={`翻译轨道 ${index + 1}用途`} value={track.purpose} onChange={event => update({ ...track, purpose: event.target.value as TranslationTrack['purpose'] })}><option value="subtitle">字幕</option><option value="replacement">替换文字</option></Select></label>
      <small>{new Set(track.contents.map(content => content.lineId)).size} 行 · {track.contents.length} 份内容</small>
      {([-1, 1] as const).map(direction => <IconButton key={direction} icon={direction < 0 ? 'up' : 'down'} disabled={index + direction < 0 || index + direction >= tracks.length} label={`${direction < 0 ? '上移' : '下移'}翻译轨道 ${index + 1}`} onClick={() => { const next = tracks.slice(); [next[index], next[index + direction]] = [next[index + direction], next[index]]; setTracks(next); }} />)}
      <IconButton icon="trash" data-role="danger" label={`删除翻译轨道 ${index + 1}`} onClick={() => setDeleting(track.id)} />
      {deleting === track.id && <p>将删除此轨道的 {track.contents.length} 份内容（{new Set(track.contents.map(content => content.lineId)).size} 行）。<button data-role="danger" onClick={() => { setTracks(items => items.filter(item => item.id !== track.id)); setSelected(ids => ids.filter(id => !track.contents.some(content => content.id === id))); setDeleting(null); }}>确认删除轨道及内容</button><button data-role="inline" onClick={() => setDeleting(null)}>取消删除</button></p>}
      <div className={styles.translationTrackContents}>{track.contents.map(content => <label key={content.id} className={styles.splitAssignment}><input type="checkbox" aria-label={`选择翻译内容 ${content.id}`} checked={selected.includes(content.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, content.id] : ids.filter(id => id !== content.id))} />
        <span><small>{lineLabel(source, source.lines.find(line => line.id === content.lineId)!)}</small> <span className={styles.romanPreviewBody}>{lineText(source.lines.find(line => line.id === content.lineId)!)} · {translationText(content)}</span></span>
      </label>)}</div>
    </section>)}</div>
    <button data-role="secondary" onClick={addTrack}>新增翻译轨道</button>
    <fieldset><legend>内容归轨</legend><p>已选择 {selected.length} 份内容；源轨道见各内容上方。文字、所属行及时间不变，语言和用途改用目标轨道属性；目标已有内容将保留，新内容追加到末尾。</p>
      <label>目标轨道 <Select aria-label="翻译归轨目标" value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">选择目标轨道</option>{tracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
      <button data-role="secondary" disabled={!selected.length || !targetId || stale} onClick={() => { try { setTracks(transferTranslations({ ...source, translationTracks: tracks }, selected, targetId)); setSelected([]); } catch (cause) { setError((cause as Error).message); } }}>转入目标轨道</button>
    </fieldset>
    {(stale || error) && <p role="alert">{stale ? '文档已变化，请重新打开翻译轨道管理。' : error}</p>}
  </SettingsDialog>;
}
