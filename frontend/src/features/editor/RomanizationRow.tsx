import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { RomanizationContent, RomanizationTrack } from '../../domain/lyric-document';
import { InlineAdd } from './InlineAdd';
import { DraftInput, TimePair } from './EditorFields';
import styles from './semantic-editor.module.css';

type Props = {
  track: RomanizationTrack;
  content: RomanizationContent;
  selectedContent: boolean;
  placeholder?: boolean;
  placeholderUnitIds?: Set<string>;
  selectedUnitIds: string[];
  selectContent: (shift?: boolean, toggle?: boolean) => void;
  selectUnit: (id: string, shift?: boolean, toggle?: boolean) => void;
  apply: (command: LyricCommand) => boolean;
};

export function RomanizationRow({ track, content, selectedContent, selectedUnitIds, placeholder, placeholderUnitIds, selectContent, selectUnit, apply }: Props) {
  useTranslation();
  const setContent = (next: RomanizationContent) => apply({ type: 'set-romanization-content', trackId: track.id, content: next });
  const insertUnit = (text: string) => {
    if (content.kind !== 'timed') return false;
    const unit = { id: crypto.randomUUID(), text, beginMs: null, endMs: null };
    if (!setContent({ ...content, units: [...content.units, unit] })) return false;
    selectUnit(unit.id); return true;
  };
  return <section className={`${styles.romanizationRow} ${selectedContent ? styles.selectedRomanization : ''}`}
    data-romanization-content-id={content.id} data-drag-placeholder={placeholder ? '' : undefined} tabIndex={0} aria-label={t('romanization.contentLabel',{language:track.language ?? t('editor.unspecifiedLanguage')})}
    onClick={(event) => { event.stopPropagation(); if (!(event.target as Element).closest('[data-romanization-unit-id],button')) selectContent(event.shiftKey, event.ctrlKey || event.metaKey); }}
    onFocus={(event) => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) selectContent(); }}>
    <div className={styles.romanizationHeader}><strong>{t('romanization.trackLabel',{language:track.language ?? t('editor.unspecifiedLanguage')})}</strong><span>{content.kind === 'timed' ? t('romanization.units',{count:content.units.length}) : t('romanization.plain')}</span>
    </div>
    {content.kind === 'plain' ? <div className={styles.romanizationPlain}>
      <DraftInput value={content.text} label={t('romanization.inputLabel',{language:track.language ?? t('editor.unspecifiedLanguage')})} onFocus={selectContent} onCommit={(text) => setContent({ ...content, text })} />
      <button data-role="secondary" onClick={() => setContent({ ...content, kind: 'timed', units: (content.text.match(/\S+\s*|\s+/gu) ?? []).map((text) => ({ id: crypto.randomUUID(), text, beginMs: null, endMs: null })) })}>{t('romanization.segmentTimed')}</button>
    </div> : <div className={styles.romanizationUnits}>
      {content.units.map((unit, index) => <div key={unit.id} data-romanization-unit-id={unit.id} data-drag-placeholder={placeholderUnitIds?.has(unit.id) ? '' : undefined} className={`${styles.romanizationUnit} ${selectedUnitIds.includes(unit.id) ? styles.selectedWord : ''}`}
        tabIndex={0} onClick={(event) => { event.stopPropagation(); selectUnit(unit.id, event.shiftKey, event.ctrlKey || event.metaKey); }} onFocus={(event) => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) selectUnit(unit.id); }}>
        <DraftInput value={unit.text} label={t('romanization.unitLabel',{number:index+1})} onFocus={() => selectUnit(unit.id)}
          onCommit={(text) => setContent({ ...content, units: content.units.map((item) => item.id === unit.id ? { ...item, text } : item) })}
          onSplit={(at) => apply({ type: 'split-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, at })} />
        <TimePair begin={unit.beginMs} end={unit.endMs} label={t('romanization.unitLabel',{number:index+1})} onCommit={(beginMs, endMs) => setContent({ ...content, units: content.units.map((item) => item.id === unit.id ? { ...item, beginMs, endMs } : item) })} />
      </div>)}
      <InlineAdd label={t('romanization.addUnit')} commit={insertUnit} />
    </div>}
  </section>;
}

const t=i18n.t.bind(i18n);
