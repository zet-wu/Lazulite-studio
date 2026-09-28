import { memo } from 'react';
import { lineText, type LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

// Outline clicks are delegated by the pane; unchanged rows keep their rendered content.
export const OutlineRow = memo(function OutlineRow({ line, ordinal, selected }: { line: LyricLine; ordinal: number | undefined; selected: boolean }) {
  return <div className={styles.outlineRow} data-line-id={line.id}>
    <button data-outline-drag className={selected ? styles.selected : ''}>
      L{ordinal} {line.backgroundOf ? '· 背景 ' : '· '}{lineText(line) || '空行'}
    </button>
  </div>;
});
