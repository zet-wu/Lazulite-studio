import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { lineText, type LyricLine as DocumentLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

type Props = {
  line: DocumentLine;
  selected: boolean;
  playhead: boolean;
  dropTarget: boolean;
  onSelect: (shift: boolean, toggle: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  children: ReactNode;
};

export function LyricLine(props: Props) {
  const select = (event: MouseEvent<HTMLElement>) => props.onSelect(event.shiftKey, event.ctrlKey || event.metaKey);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || !event.altKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      props.onMove(event.key === 'ArrowUp' ? -1 : 1);
    }
  };
  return <section className={`${styles.line} ${props.selected ? styles.selectedLine : ''} ${props.playhead ? styles.playheadLine : ''} ${props.dropTarget ? styles.dropLine : ''}`}
    data-line-id={props.line.id} tabIndex={0} aria-label={`歌词行 ${lineText(props.line) || '空行'}`}
    onClick={(event) => { if (!(event.target as Element).closest('[data-word-id]')) select(event); }}
    onKeyDown={keyDown}>
    {props.children}
  </section>;
}
