import type { ReactNode } from 'react';
import styles from '../shared/timeline-element.module.css';
/** One translated layer per lane; the parent clips complete, stable-width objects. */
export function TimelineContent({children}:{children:ReactNode}) {
  return <div className={styles.content} data-motion-content>{children}</div>;
}
export function timelineViewStart(element: Element, fallback: number) {
  const value = element.closest<HTMLElement>('#timeline-plots')?.dataset.viewStart;
  return value === undefined ? fallback : Number(value);
}
