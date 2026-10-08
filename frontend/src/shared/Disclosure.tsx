import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './disclosure.module.css';

export function DisclosureTrigger({ open, controls, id, toggle, children }: {
  open: boolean; controls: string; id?: string; toggle: () => void; children: ReactNode;
}) {
  return <button type="button" data-role="inline" className={styles.trigger} id={id} aria-expanded={open} aria-controls={controls} onClick={toggle}>
    <span>{children}</span><Icon name="chevron" />
  </button>;
}
export function Disclosure({ title, initiallyOpen = false, open: controlled, onOpenChange, children, className }: {
  title: ReactNode; initiallyOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void;
  children: () => ReactNode; className?: string;
}) {
  const [localOpen, setOpen] = useState(initiallyOpen);
  const open = controlled ?? localOpen, id = useId();
  return <div className={`${styles.disclosure} ${className ?? ''}`}>
    <DisclosureTrigger id={`${id}-trigger`} open={open} controls={id} toggle={() => { setOpen(!open); onOpenChange?.(!open); }}>{title}</DisclosureTrigger>
    {open && <div id={id} aria-labelledby={`${id}-trigger`} className={styles.content}>{children()}</div>}
  </div>;
}
