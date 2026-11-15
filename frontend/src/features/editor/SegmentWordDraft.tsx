import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricWord } from '../../domain/lyric-document';
import { graphemes, moveSegmentRuby, toggleSegmentBoundary } from '../../domain/segmentation-draft';
import { DialogEditingLocked } from './SettingsDialog';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

export function SegmentWordDraft({ source, words, editable, reason, selected, select, clearSelection, change }: {
  source: LyricWord; words: LyricWord[]; editable: boolean; reason: string; selected: string[];
  select: (id: string, shift?: boolean, toggle?: boolean, preserve?: boolean) => void;
  clearSelection: () => void; change: (words: LyricWord[]) => void;
}) {
  const { t } = useTranslation();
  const locked = useContext(DialogEditingLocked);
  const root = useRef<HTMLSpanElement>(null);
  const pointerFocus = useRef(false);
  const pendingFocus = useRef<{kind: 'ruby' | 'boundary'; id: string} | null>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    root.current?.querySelector<HTMLButtonElement>(`[data-segment-${pendingFocus.current.kind}="${CSS.escape(pendingFocus.current.id)}"]`)?.focus({preventScroll:true});
    pendingFocus.current = null;
  }, [words]);
  const move = (destination: number, ids = selected, focusId?: string) => {
    const next = moveSegmentRuby(words, ids, destination);
    if (next && !locked) { pendingFocus.current = focusId ? {kind:'ruby', id:focusId} : null; change(next); }
  };
  const boundary = (position: number, active: boolean) => <button data-segment-boundary={position} data-role="inline" title={t('segment.boundary', {number:position})} aria-label={t('segment.boundary', {number:position})} aria-pressed={active}
    onClick={() => {pendingFocus.current = {kind:'boundary', id:String(position)}; change(toggleSegmentBoundary(source, words, position)); clearSelection();}}><Icon name={active ? 'sync-beat' : 'sync-dot'}/></button>;
  let offset = 0;
  return <span ref={root} className={`${styles.segmentSource} ${reason ? styles.readingHint : ''}`} data-tooltip={reason || undefined} title={reason || undefined} tabIndex={reason ? 0 : undefined} aria-label={editable ? t('segment.boundaries') : undefined}>
    {words.map((word, partIndex) => {
      const start = offset, chars = graphemes(word.text); offset += chars.length;
      return <span key={word.id} className={styles.segmentGroup}>
        <span className={styles.segmentPiece} data-drop={over === partIndex || undefined}
          onDragOver={event => { if (editable && !locked && dragging && moveSegmentRuby(words, selected, partIndex)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(partIndex); } }}
          onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); if (dragging) move(partIndex); setOver(null); setDragging(false); }}>
          <span className={styles.segmentRuby}>{word.rubyUnits.map(unit => editable ? <button key={unit.id} data-segment-ruby={unit.id} aria-keyshortcuts="ArrowLeft ArrowRight" data-role="inline" aria-pressed={selected.includes(unit.id)} draggable={!locked}
            onPointerDown={() => { pointerFocus.current = true; }} onPointerUp={() => { pointerFocus.current = false; }} onPointerCancel={() => { pointerFocus.current = false; }}
            onFocus={() => { if (!pointerFocus.current) select(unit.id, false, false, true); }}
            onClick={event => select(unit.id, event.shiftKey, event.ctrlKey || event.metaKey)}
            onKeyDown={event => {
              if (locked || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
              event.preventDefault(); event.stopPropagation();
              const ids = selected.includes(unit.id) ? selected : [unit.id];
              if (!selected.includes(unit.id)) select(unit.id);
              const owners = words.flatMap((part, index) => part.rubyUnits.some(ruby => ids.includes(ruby.id)) ? [index] : []);
              move(event.key === 'ArrowLeft' ? owners.at(-1)! - 1 : owners[0] + 1, ids, unit.id);
            }}
            onDragStart={event => { select(unit.id, false, false, true); setDragging(true); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', unit.id); }}
            onDragEnd={() => { pointerFocus.current = false; setDragging(false); setOver(null); }}>{unit.reading}</button> : <span key={unit.id}>{unit.reading}</span>)}</span>
          <span className={styles.segmentBody}>{chars.map((char, index) => <span key={index}>{char}{editable && index < chars.length - 1 && boundary(start + index + 1, false)}</span>)}</span>
        </span>
        {partIndex < words.length - 1 && <span className={styles.segmentBoundary}>{editable ? boundary(start + chars.length, true) : <Icon name="sync-beat"/>}</span>}
      </span>;
    })}
  </span>;
}
