import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { plainTranslation, type SubLyric } from '../../domain/lyric-document';
import { nonemptyTranslations } from '../../domain/sublyrics';
import { Icon } from '../../shared/Icon';
import { Select } from '../../shared/Select';
import { useEditorSelection } from './SelectionContext';
import styles from './semantic-editor.module.css';

function TranslationRow({ item, index, commit, remove, fresh = false }: {
  item: SubLyric; index: number; commit: (item: SubLyric) => void; remove: () => void; fresh?: boolean;
}) {
  const [draft, setDraft] = useState(item);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false), cancelled = useRef(false);
  useEffect(() => { setDraft(item); setError(''); }, [item]);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, [draft]);
  const submit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (composing.current || JSON.stringify(draft) === JSON.stringify(item)) return;
    try { nonemptyTranslations([draft]); commit(draft); setError(''); } catch (cause) { setError((cause as Error).message); }
  };
  return <div data-translation-id={item.id} className={styles.translationRow} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLElement).blur(); }
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(item); setError(''); (event.target as HTMLElement).blur(); if (fresh) remove(); }
  }}>
    {draft.kind === 'plain' ? <textarea ref={textRef} rows={1} autoFocus={fresh} aria-label={`翻译 ${index + 1}`} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} onBlur={submit} /> : <div><small>定时翻译</small>{draft.units.map((unit, unitIndex) => <div key={unit.id} data-translation-unit-id={unit.id}>
      <input aria-label={`翻译 ${index + 1} 单元 ${unitIndex + 1}`} value={unit.text} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, text: event.target.value } : value) })} onBlur={submit} />
      {(['beginMs', 'endMs'] as const).map(side => <input key={side} type="number" min="0" step="1" placeholder="未定" aria-label={`翻译 ${index + 1} 单元 ${unitIndex + 1} ${side === 'beginMs' ? '开始' : '结束'}毫秒`} value={unit[side] ?? ''} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, [side]: event.target.value === '' ? null : Number(event.target.value) } : value) })} onBlur={submit} />)}
    </div>)}</div>}
    <input className={styles.translationLanguage} aria-label={`翻译 ${index + 1}语言`} placeholder="未指定语言" value={draft.language ?? ''} aria-invalid={Boolean(error)} onChange={event => setDraft({ ...draft, language: event.target.value || null })} onBlur={submit} />
    <Select aria-label={`翻译 ${index + 1}用途`} value={draft.purpose} onChange={event => { const next = { ...draft, purpose: event.target.value as SubLyric['purpose'] }; try { nonemptyTranslations([next]); commit(next); } catch (cause) { setError((cause as Error).message); } }}><option value="subtitle">字幕</option><option value="replacement">替换文字</option></Select>
    <button data-role="danger" className={`icon-button ${styles.iconButton}`} aria-label="删除翻译" onMouseDown={event => event.preventDefault()} onClick={remove}><Icon name="trash" /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
export function TranslationEditor({ items, apply }: { items: SubLyric[]; apply: (items: SubLyric[]) => boolean }) {
  const [adding, setAdding] = useState<SubLyric | null>(null);
  const shared = useEditorSelection();
  return <div className={styles.sublyrics} onFocus={() => shared?.setSelection(null)}><div><strong>翻译</strong>
    {items.map((item, index) => <TranslationRow key={item.id} item={item} index={index} commit={next => apply(items.map(value => value.id === item.id ? next : value))} remove={() => apply(items.filter(value => value.id !== item.id))} />)}
    {adding && <TranslationRow item={adding} index={items.length} fresh remove={() => setAdding(null)} commit={item => { if (item.kind === 'plain' && item.text.trim() && apply([...items, item])) setAdding(null); }} />}
    <button data-role="secondary" disabled={Boolean(adding)} onClick={() => setAdding(plainTranslation(''))}>添加</button>
  </div></div>;
}
