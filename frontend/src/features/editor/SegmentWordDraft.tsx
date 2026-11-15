import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricWord } from '../../domain/lyric-document';
import { graphemes, moveSegmentRuby, toggleSegmentBoundary } from '../../domain/segmentation-draft';
import { DialogEditingLocked } from './SettingsDialog';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

export function SegmentWordDraft({ source, words, editable, reason, change }: {
  source: LyricWord; words: LyricWord[]; editable: boolean; reason: string; change: (words: LyricWord[]) => void;
}) {
  const { t } = useTranslation();
  const locked = useContext(DialogEditingLocked);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<number | null>(null);
  const move = (destination: number) => {
    const next = moveSegmentRuby(words, selected, destination);
    if (next && !locked) change(next);
  };
  let offset = 0;
  const firstOwner = words.findIndex(word => word.rubyUnits.some(unit => selected.includes(unit.id)));
  const lastOwner = words.reduce((last, word, index) => word.rubyUnits.some(unit => selected.includes(unit.id)) ? index : last, -1);
  return <span className={`${styles.segmentSource} ${reason ? styles.readingHint : ''}`} data-tooltip={reason || undefined} title={reason || undefined} tabIndex={reason ? 0 : undefined} aria-label={editable ? t('segment.boundaries') : undefined}>
    {words.map((word, partIndex) => {
      const start = offset, chars = graphemes(word.text); offset += chars.length;
      return <span key={word.id} className={styles.segmentPiece} data-drop={over === partIndex || undefined}
        onDragOver={event => { if (editable && !locked && dragging && moveSegmentRuby(words, selected, partIndex)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(partIndex); } }}
        onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); if (dragging) move(partIndex); setOver(null); setDragging(false); }}>
        <span className={styles.segmentRuby}>{word.rubyUnits.map(unit => editable ? <button key={unit.id} data-role="inline" aria-pressed={selected.includes(unit.id)} draggable={!locked}
          onClick={event => setSelected(previous => event.ctrlKey || event.metaKey || event.shiftKey ? previous.includes(unit.id) ? previous.filter(id => id !== unit.id) : [...previous, unit.id] : [unit.id])}
          onDragStart={event => { const ids = selected.includes(unit.id) ? selected : [unit.id]; setSelected(ids); setDragging(true); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', unit.id); }}
          onDragEnd={() => { setDragging(false); setOver(null); }}>{unit.reading}</button> : <span key={unit.id}>{unit.reading}</span>)}</span>
        <span className={styles.segmentBody}>{chars.map((char, index) => <span key={index}>{char}{editable && start + index + 1 < graphemes(source.text).length && <button data-role="inline" title={t('segment.boundary', {number:start + index + 1})} aria-label={t('segment.boundary', {number:start + index + 1})} aria-pressed={index === chars.length - 1} onClick={() => {change(toggleSegmentBoundary(source, words, start + index + 1)); setSelected([]);}}><Icon name={index === chars.length - 1 ? 'sync-beat' : 'sync-dot'}/></button>}</span>)}</span>
      </span>;
    })}
    {editable && selected.length > 0 && <span className={styles.segmentMoves}>{([-1, 1] as const).map(direction => {
      const destination = direction < 0 ? lastOwner - 1 : firstOwner + 1;
      return <button key={direction} data-role="inline" title={t(direction < 0 ? 'segment.movePrevious' : 'segment.moveNext')} aria-label={t(direction < 0 ? 'segment.movePrevious' : 'segment.moveNext')} disabled={!moveSegmentRuby(words, selected, destination)} onClick={() => move(destination)}><span style={{display:'inline-flex', transform:direction < 0 ? 'rotate(180deg)' : undefined}}><Icon name="chevron"/></span></button>;
    })}</span>}
  </span>;
}
