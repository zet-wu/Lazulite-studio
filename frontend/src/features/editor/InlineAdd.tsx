import { Icon } from '../../shared/Icon';
import { useRef, useState } from 'react';
import styles from './semantic-editor.module.css';

/** The draft does not enter document history until a successful nonempty commit. */
export function InlineDraft({ label, commit, close }: { label: string; commit: (text: string) => boolean; close: () => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false), finished = useRef(false);
  const submit = () => {
    if (finished.current || composing.current) return;
    finished.current = true;
    const text = input.current!.value;
    if (!text.length || commit(text)) close();
    else { finished.current = false; setError('添加失败，请检查错误说明后重试，输入已保留'); }
  };
  return <span className={styles.inlineAdd} onClick={event => event.stopPropagation()}>
    <input ref={input} autoFocus aria-label={label} aria-invalid={Boolean(error)} value={draft} onChange={event => { setDraft(event.target.value); setError(''); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => {
        composing.current = false;
        if (event.currentTarget !== document.activeElement) submit();
      }} onBlur={submit} onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finished.current = true; close(); }
      }} />
    {error && <small role="alert">{error}</small>}
  </span>;
}

export function InlineAdd({ label, commit }: { label: string; commit: (text: string) => boolean }) {
  const [active, setActive] = useState(false);
  return active ? <InlineDraft label={label} commit={commit} close={() => setActive(false)} />
    : <span className={styles.inlineAdd} onClick={event => event.stopPropagation()}><button data-role="inline" className="icon-button" title={label} data-tooltip={label} aria-label={label} onClick={() => setActive(true)}><Icon name="add"/></button></span>;
}
