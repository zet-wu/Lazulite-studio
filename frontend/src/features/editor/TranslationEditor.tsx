import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { plainTranslation, type TranslationContent, type LyricDocument, type TranslationTrack } from '../../domain/lyric-document';
import type { LyricCommand } from '../../domain/lyric-commands';
import { translationTrackLabel } from './TranslationTrackDialog';
import { Icon } from '../../shared/Icon';
import { Select } from '../../shared/Select';
import { useEditorSelection } from './SelectionContext';
import styles from './semantic-editor.module.css';

function TranslationRow({ item, index, commit, remove, fresh = false }: {
  item: TranslationContent; index: number; commit: (item: TranslationContent) => void; remove: () => void; fresh?: boolean;
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
    try { commit(draft); setError(''); } catch (cause) { setError((cause as Error).message); }
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
    <button data-role="danger" className={`icon-button ${styles.iconButton}`} aria-label="删除翻译" onMouseDown={event => event.preventDefault()} onClick={remove}><Icon name="trash" /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
export function TranslationEditor({ document, lineId, apply, manage }: { document: LyricDocument; lineId: string; apply: (command: LyricCommand) => boolean; manage: () => void }) {
  const [adding, setAdding] = useState<TranslationContent | null>(null);
  const [trackId, setTrackId] = useState('');
  const shared = useEditorSelection();
  const items = document.translationTracks.flatMap((track, index) => track.contents.filter(content => content.lineId === lineId).map(content => ({ track, index, content })));
  const submit = (tracks: TranslationTrack[]) => apply({ type: 'set-translation-tracks', source: document.translationTracks, tracks });
  return <div className={styles.sublyrics} onFocus={() => shared?.setSelection(null)}><div>
    <div className={styles.translationToolbar}><strong>翻译</strong>
    <label>添加到 <Select aria-label="新增翻译的轨道" value={trackId} disabled={Boolean(adding)} onChange={event => setTrackId(event.target.value)}><option value="">选择轨道</option>{document.translationTracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
    <button data-role="secondary" disabled={Boolean(adding) || !document.translationTracks.some(track => track.id === trackId)} onClick={() => setAdding(plainTranslation('', lineId))}>添加</button>
    <button data-role="inline" onClick={manage}>管理翻译轨道…</button>
    </div>
    {items.map(({ track, index: trackIndex, content }, index) => <div key={content.id}>
      <small>{translationTrackLabel(track, trackIndex)}</small>
      <TranslationRow item={content} index={index} commit={next => submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.map(item => item.id === content.id ? next : item) }))}
        remove={() => submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.filter(item => item.id !== content.id) }))} />
    </div>)}
    {adding && <TranslationRow item={adding} index={items.length} fresh remove={() => setAdding(null)} commit={content => { if (apply({ type: 'insert-translation-content', trackId, content })) setAdding(null); }} />}

  </div></div>;
}
