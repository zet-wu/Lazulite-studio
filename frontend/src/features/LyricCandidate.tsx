import type { ReactNode } from 'react';
import styles from './acquisition.module.css';

export function LyricCandidate({ title, detail, badges, status, failed, selected, disabled, onSelect }: {
  title: ReactNode; detail?: ReactNode; badges: string[]; status?: string; failed?: boolean;
  selected: boolean; disabled?: boolean; onSelect: () => void;
}) {
  return <button data-role="secondary" aria-pressed={selected} disabled={disabled} onClick={onSelect}>
    <strong>{title}</strong>{detail && <small>{detail}</small>}
    <span className={styles.badges}>{badges.map(badge => <span key={badge} className={styles.badgeBlue}>{badge}</span>)}
      {status && <span className={failed ? styles.badgeRed : styles.badgeYellow}>{status}</span>}
    </span>
  </button>;
}
