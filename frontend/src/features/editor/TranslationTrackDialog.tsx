import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { lineLabel } from '../line-label';
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

export const translationTrackLabel = (track: TranslationTrack, index: number) => t('translation.trackLabel',{number:index+1,language:track.language ?? t('editor.unspecifiedLanguage'),purpose:track.purpose});
export function TranslationTrackDialog({ document, apply, close }: { document: LyricDocument; apply: (command: LyricCommand) => boolean; close: () => void }) {
  useTranslation();
  const [source] = useState(document);
  const [tracks, setTracks] = useState(source.translationTracks);
  const [selected, setSelected] = useState<string[]>([]), [targetId, setTargetId] = useState('');
  const [error, setError] = useMessageText('');
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
  return <SettingsDialog title={t('translation.manage')} close={close} actions={<><button data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" disabled={stale} onClick={() => {
    try { if (apply({ type: 'set-translation-tracks', source: source.translationTracks, tracks })) close(); } catch (cause) { setError(errorMessage(cause)); }
  }}>{t('common.apply')}</button></>}>
    <BooleanField label={t('translation.selectAll')} {...selectionProps(allIds)} />
    <div className={styles.trackManager}>{tracks.map((track, index) => <section className={styles.translationTrackSection} key={track.id}>
      <strong>{translationTrackLabel(track, index)}</strong>
      <label>{t('translation.language')}<input aria-label={t('translation.languageLabel',{number:index+1})} placeholder={t('editor.unspecifiedLanguage')} value={track.language ?? ''} onChange={event => update({ ...track, language: event.target.value || null })} /></label>
      <label>{t('translation.type')}<Select aria-label={t('translation.typeLabel',{number:index+1})} value={track.purpose} onChange={event => update({ ...track, purpose: event.target.value as TranslationTrack['purpose'] })}><option value="subtitle">subtitle</option><option value="replacement">replacement</option></Select></label>
      <small>{t('translation.trackCounts',{lines:new Set(track.contents.map(content => content.lineId)).size,contents:track.contents.length})}</small>
      {([-1, 1] as const).map(direction => <IconButton key={direction} icon={direction < 0 ? 'up' : 'down'} disabled={index + direction < 0 || index + direction >= tracks.length} label={t('translation.moveLabel',{direction:direction < 0 ? t('translation.up') : t('translation.down'),number:index+1})} onClick={() => { const next = tracks.slice(); [next[index], next[index + direction]] = [next[index + direction], next[index]]; setTracks(next); }} />)}
      <IconButton icon="trash" data-role="danger" label={t('translation.deleteTrack',{count:track.contents.length,number:index+1})} onClick={() => {
        setTracks(items => items.filter(item => item.id !== track.id));
        setSelected(ids => ids.filter(id => !track.contents.some(content => content.id === id)));
        if (targetId === track.id) setTargetId('');
      }} />
      <BooleanField label={t('translation.selectTrack')} {...selectionProps(track.contents.map(content => content.id))} />
      <div className={styles.translationTrackContents}>{track.contents.map((content,contentIndex) => {
        const line = source.lines.find(line => line.id === content.lineId)!;
        const body = lineText(line), translation = translationText(content);
        return <label key={content.id} className={styles.translationReference}>
          <input type="checkbox" aria-label={t('translation.selectContent',{track:index+1,line:lineLabel(source,line),number:contentIndex+1})} aria-describedby={`translation-reference-${content.id}`} checked={selected.includes(content.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, content.id] : ids.filter(id => id !== content.id))} />
          <small>{lineLabel(source, line)}</small>
          <span className={styles.translationBody}>{shortReference(body)}</span>
          <span className={styles.translationText}>{shortReference(translation)}</span>
          <span id={`translation-reference-${content.id}`} className={styles.translationFull}>
            <span>{t('batch.mainText')}</span><span className={styles.translationBody}>{body}</span>
            <span>{t('capability.translation')}</span><span className={styles.translationText}>{translation}</span>
          </span>
        </label>;
      })}</div>
    </section>)}</div>
    <IconButton icon="add" label={t('translation.newTranslationTrack')} onClick={addTrack}/>
    <fieldset><legend>{t('translation.assign')}</legend><p>{t('translation.moveSummary',{selected:selected.length,moved:movedCount,removed:removedCount})}</p>
      <label>{t('translation.target')}<Select aria-label={t('translation.targetLabel')} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">{t('translation.chooseTarget')}</option>{tracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
      <button data-role="secondary" disabled={!movedCount || !tracks.some(track => track.id === targetId) || stale} onClick={() => { try { setTracks(transferTranslations({ ...source, translationTracks: tracks }, selected, targetId)); setSelected([]); } catch (cause) { setError(errorMessage(cause)); } }}>{t('translation.move')}</button>
    </fieldset>
    {(stale || error) && <p role="alert">{stale ? t('translation.stale') : error}</p>}
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
