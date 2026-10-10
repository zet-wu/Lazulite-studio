import type { MouseEvent, ReactNode } from 'react';
import styles from './semantic-editor.module.css';

type Props = {
  id: string;
  selected: boolean;
  placeholder?: boolean;
  onSelect: (shift: boolean, toggle: boolean) => void;
  children: ReactNode;
};

export function LyricWord(props: Props) {
  const select = (event: MouseEvent<HTMLDivElement>) => props.onSelect(event.shiftKey, event.ctrlKey || event.metaKey);
  return <div className={`${styles.word} ${props.selected ? styles.selectedWord : ''}`}
    data-drag-placeholder={props.placeholder ? '' : undefined} data-word-id={props.id} tabIndex={0}
    onFocus={(event) => { if (event.target === event.currentTarget && !event.currentTarget.closest('[data-pointer-focus], [data-selection-focus]')) props.onSelect(false, false); }}
    onClick={(event) => {
      if (!(event.target as Element).closest('[data-ruby-id],button')) select(event);
    }}
    >
    {props.children}
  </div>;
}
