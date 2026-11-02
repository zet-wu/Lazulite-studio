import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { memo } from 'react';
import { lineText, type LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

// Outline clicks are delegated by the pane; unchanged rows keep their rendered content.
export const OutlineRow = memo(function OutlineRow({ line, ordinal, selected, placeholder, context }: { line: LyricLine; ordinal: number | undefined; selected: boolean; placeholder?: boolean; context?: boolean }) {
  useTranslation();
  return <div className={styles.outlineRow} data-line-id={line.id} data-active-context={context || undefined} data-drag-placeholder={placeholder ? '' : undefined}>
    <button data-role="secondary" data-outline-drag aria-pressed={selected} className={selected ? styles.selected : ''}>
      <span className={styles.outlineNumber}>L{ordinal}</span><span className={styles.outlineText}>{line.backgroundOf && <small>{t('outline.background')}</small>}{lineText(line) || t('outline.emptyLine')}</span>
    </button>
  </div>;
});

const t=i18n.t.bind(i18n);
