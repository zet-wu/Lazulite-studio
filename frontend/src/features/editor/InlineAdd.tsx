import { useRef, useState } from 'react';
import styles from './semantic-editor.module.css';

/** Drafts stay local until one nonempty submission; leaving the object never dismisses input. */
export function InlineAdd({ label, commit }: { label: string; commit: (text: string) => boolean }) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const finished = useRef(false);
  const submit = () => {
    if (finished.current || composing.current) return;
    finished.current = true;
    const text = input.current!.value;
    if (!text.trim() || commit(text)) { setActive(false); setDraft(''); }
    else finished.current = false;
  };
  return <span className={styles.inlineAdd} onClick={event => event.stopPropagation()}>
    {active ? <input ref={input} autoFocus aria-label={label} value={draft} onChange={event => setDraft(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => {
        composing.current = false;
        if (event.currentTarget !== document.activeElement) submit();
      }} onBlur={submit} onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finished.current = true; setActive(false); setDraft(''); }
      }} /> : <button aria-label={label} onClick={() => { finished.current = false; setActive(true); }}>＋</button>}
  </span>;
}
