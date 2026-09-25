import type { DragEvent, MouseEvent, ReactNode } from 'react';
import styles from './semantic-editor.module.css';

type Props = {
  id: string;
  selected: boolean;
  dropTarget: boolean;
  onSelect: (shift: boolean, toggle: boolean) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

export function LyricWord(props: Props) {
  const select = (event: MouseEvent<HTMLDivElement>) => props.onSelect(event.shiftKey, event.ctrlKey || event.metaKey);
  return <div className={`${styles.word} ${props.selected ? styles.selectedWord : ''} ${props.dropTarget ? styles.dropWord : ''}`}
    data-word-id={props.id} tabIndex={0}
    onFocus={(event) => { if (event.target === event.currentTarget) props.onSelect(false, false); }}
    onMouseDown={(event) => {
      if ((event.target as Element).closest('[draggable="true"]')) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); select(event); }
    }}
    onClick={(event) => {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !(event.target as Element).closest('[data-ruby-id],button')) select(event);
    }}
    onDragOver={props.onDragOver} onDrop={props.onDrop}>
    {props.children}
  </div>;
}
