import type { LyricCommand } from '../../domain/lyric-commands';
import type { RomanizationContent, RomanizationTrack } from '../../domain/lyric-document';
import { DraftInput, TimePair } from './EditorFields';
import styles from './semantic-editor.module.css';

type Props = {
  track: RomanizationTrack;
  content: RomanizationContent;
  selectedContent: boolean;
  selectedUnitIds: string[];
  selectContent: (shift?: boolean, toggle?: boolean) => void;
  selectUnit: (id: string, shift?: boolean, toggle?: boolean) => void;
  apply: (command: LyricCommand) => boolean;
  moveUp: () => void;
  moveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

export function RomanizationRow({ track, content, selectedContent, selectedUnitIds, selectContent, selectUnit, apply, moveUp, moveDown, canMoveUp, canMoveDown }: Props) {
  const setContent = (next: RomanizationContent) => apply({ type: 'set-romanization-content', trackId: track.id, content: next });
  const insertUnit = () => {
    if (content.kind !== 'timed') return;
    const unit = { id: crypto.randomUUID(), text: '', beginUs: null, endUs: null };
    if (setContent({ ...content, units: [...content.units, unit] })) selectUnit(unit.id);
  };
  const duplicate = () => apply({ type: 'insert-romanization-content', trackId: track.id, content: content.kind === 'plain'
    ? { ...content, id: crypto.randomUUID() }
    : { ...content, id: crypto.randomUUID(), units: content.units.map((unit) => ({ ...unit, id: crypto.randomUUID() })) } });
  return <section className={`${styles.romanizationRow} ${selectedContent ? styles.selectedLine : ''}`}
    data-romanization-content-id={content.id} tabIndex={0} aria-label={`音译内容 ${track.language ?? '未指定语言'}`}
    onClick={(event) => { event.stopPropagation(); if (!(event.target as Element).closest('[data-romanization-unit-id],button,input')) selectContent(event.shiftKey, event.ctrlKey || event.metaKey); }}
    onFocus={(event) => { if (event.target === event.currentTarget) selectContent(); }}>
    <div className={styles.romanizationHeader}><strong>音译 · {track.language ?? '未指定语言'}</strong><span>{content.kind === 'timed' ? `${content.units.length} 单元` : '普通文本'}</span>
      <button aria-label="音译内容上移" disabled={!canMoveUp} onClick={moveUp}>↑</button>
      <button aria-label="音译内容下移" disabled={!canMoveDown} onClick={moveDown}>↓</button>
      <button aria-label="复制音译内容" onClick={duplicate}>复制</button>
      <button aria-label="删除音译内容" onClick={() => apply({ type: 'delete-romanization-content', trackId: track.id, contentId: content.id })}>删除</button>
    </div>
    {content.kind === 'plain' ? <div className={styles.romanizationPlain}>
      <DraftInput value={content.text} label={`音译 ${track.language ?? '未指定语言'}`} onFocus={selectContent} onCommit={(text) => setContent({ ...content, text })} />
      <button onClick={() => setContent({ ...content, kind: 'timed', units: (content.text.match(/\S+\s*|\s+/gu) ?? []).map((text) => ({ id: crypto.randomUUID(), text, beginUs: null, endUs: null })) })}>分词并定时</button>
    </div> : <div className={styles.romanizationUnits}>
      {content.units.map((unit, index) => <div key={unit.id} data-romanization-unit-id={unit.id} className={`${styles.romanizationUnit} ${selectedUnitIds.includes(unit.id) ? styles.selectedWord : ''}`}
        tabIndex={0} onClick={(event) => { event.stopPropagation(); selectUnit(unit.id, event.shiftKey, event.ctrlKey || event.metaKey); }} onFocus={(event) => { if (event.target === event.currentTarget) selectUnit(unit.id); }}>
        <DraftInput value={unit.text} label={`音译单元 ${index + 1}`} onFocus={() => selectUnit(unit.id)}
          onCommit={(text) => setContent({ ...content, units: content.units.map((item) => item.id === unit.id ? { ...item, text } : item) })}
          onSplit={(at) => apply({ type: 'split-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, at })} />
        <TimePair begin={unit.beginUs} end={unit.endUs} label={`音译单元 ${index + 1}`} onCommit={(beginUs, endUs) => setContent({ ...content, units: content.units.map((item) => item.id === unit.id ? { ...item, beginUs, endUs } : item) })} />
        <div className={styles.romanizationUnitActions}>
          <button aria-label={`拆分音译单元 ${index + 1}`} disabled={Array.from(unit.text).length < 2} onClick={() => apply({ type: 'split-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, at: Math.floor(Array.from(unit.text).length / 2) })}>拆</button>
          <button aria-label={`合并前音译单元 ${index + 1}`} disabled={index === 0} onClick={() => apply({ type: 'merge-romanization-units', trackId: track.id, contentId: content.id, firstUnitId: content.units[index - 1].id, secondUnitId: unit.id })}>合</button>
          <button aria-label={`音译单元前移 ${index + 1}`} disabled={index === 0} onClick={() => apply({ type: 'move-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, afterUnitId: content.units[index - 2]?.id ?? null })}>←</button>
          <button aria-label={`音译单元后移 ${index + 1}`} disabled={index === content.units.length - 1} onClick={() => apply({ type: 'move-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, afterUnitId: content.units[index + 1].id })}>→</button>
          <button aria-label={`删除音译单元 ${index + 1}`} onClick={() => setContent({ ...content, units: content.units.filter((item) => item.id !== unit.id) })}>×</button>
        </div>
      </div>)}
      <button onClick={insertUnit}>添加音译单元</button>
    </div>}
  </section>;
}
