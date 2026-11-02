import { useTranslation } from 'react-i18next';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { lineText, type LyricLine as DocumentLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

type Props = {
  line: DocumentLine;
  selected: boolean;
  placeholder?: boolean;
  playhead: boolean;
  onSelect: (shift: boolean, toggle: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  children: ReactNode;
};

export function LyricLine(props: Props) {
  const {t}=useTranslation();
  const select = (event: MouseEvent<HTMLElement>) => props.onSelect(event.shiftKey, event.ctrlKey || event.metaKey);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || !event.altKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      props.onMove(event.key === 'ArrowUp' ? -1 : 1);
    }
  };
  return <section className={`${styles.line} ${props.selected ? styles.selectedLine : ''} ${props.playhead ? styles.playheadLine : ''}`}
    data-drag-placeholder={props.placeholder ? '' : undefined} data-line-id={props.line.id} tabIndex={0} aria-label={t('sync.lineLabel',{text:lineText(props.line)||t('sync.emptyLine')})}
    onClick={(event) => { if (!(event.target as Element).closest('[data-word-id], [data-romanization-content-id], input, textarea, button')) select(event); }}
    onKeyDown={keyDown}>
    {props.children}
  </section>;
}
