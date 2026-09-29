import { memo } from 'react';
import { lineText, type LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

// Outline clicks are delegated by the pane; unchanged rows keep their rendered content.
export const OutlineRow = memo(function OutlineRow({ line, ordinal, selected, placeholder }: { line: LyricLine; ordinal: number | undefined; selected: boolean; placeholder?: boolean }) {
  return <div className={styles.outlineRow} data-line-id={line.id} data-drag-placeholder={placeholder ? '' : undefined}>
    <button data-outline-drag className={selected ? styles.selected : ''}>
      <span className={styles.outlineNumber}>L{ordinal}</span><span className={styles.outlineText}>{line.backgroundOf && <small>背景 </small>}{lineText(line) || '空行'}</span>
    </button>
  </div>;
});
