import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SubLyric } from '../../domain/lyric-document';
import { validateLanguageTag } from '../../domain/sublyrics';
import { Icon } from '../../shared/Icon';
import styles from './semantic-editor.module.css';

function TranslationRow({ item, index, commit, remove, fresh = false }: {
  item: SubLyric; index: number; commit: (item: SubLyric) => void; remove: () => void; fresh?: boolean;
}) {
  const [text, setText] = useState(item.text);
  const [language, setLanguage] = useState(item.language ?? '');
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textRef.current!;
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  const composing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { setText(item.text); setLanguage(item.language ?? ''); setError(''); }, [item]);
  const submit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (text === item.text && language === (item.language ?? '')) return;
    try {
      if (text.trim()) validateLanguageTag(language || null);
      setError('');
      commit({ text, language: language || null });
    } catch (cause) { setError((cause as Error).message); }
  };
  return <div className={styles.translationRow} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement | HTMLTextAreaElement).blur(); }
      if (event.key === 'Escape') {
        event.stopPropagation(); cancelled.current = true;
        setText(item.text); setLanguage(item.language ?? ''); setError('');
        (event.target as HTMLInputElement | HTMLTextAreaElement).blur(); if (fresh) remove();
      }
    }}>
    <textarea ref={textRef} rows={1} autoFocus={fresh} aria-label={`翻译 ${index + 1}`} value={text} onChange={event => setText(event.target.value)} onBlur={submit} />
    <input className={styles.translationLanguage} aria-label={`翻译 ${index + 1}语言`} placeholder="未指定语言" value={language} aria-invalid={Boolean(error)} onChange={event => setLanguage(event.target.value)} onBlur={submit} />
    <button data-role="danger" className={styles.iconButton} aria-label="删除翻译" onMouseDown={event => event.preventDefault()} onClick={remove}><Icon name="trash" /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}

const emptyTranslation: SubLyric = { language: null, text: '' };
export function TranslationEditor({ items, apply }: { items: SubLyric[]; apply: (items: SubLyric[]) => boolean }) {
  const [adding, setAdding] = useState(false);
  return <div className={styles.sublyrics}><div><strong>翻译</strong>
    {items.map((item, index) => <TranslationRow key={index} item={item} index={index}
      commit={next => apply(items.map((value, i) => i === index ? next : value))}
      remove={() => apply(items.filter((_, i) => i !== index))} />)}
    {adding && <TranslationRow item={emptyTranslation} index={items.length} fresh remove={() => setAdding(false)} commit={item => {
      if (item.text.trim() && apply([...items, item])) setAdding(false);
    }} />}
    <button data-role="secondary" disabled={adding} onClick={() => setAdding(true)}>添加</button>
  </div></div>;
}
