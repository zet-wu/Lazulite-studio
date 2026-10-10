import { selectIds } from './editing-actions';
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
  const shared = useEditorSelection();
  const selected = shared?.selection;
  const choose = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, unitId?: string) => {
    event.stopPropagation();
    const row=event.currentTarget.closest<HTMLElement>('[data-translation-track]')!;
    const trackId=row.dataset.translationTrack!;
    const id=unitId??item.id, kind=unitId?'romanization-unit' as const:'romanization-content' as const;
    const previous=selected?.kind===kind&&selected.attachment==='translation'?selected:null;
    const order=unitId&&item.kind==='timed'?item.units.map(unit=>unit.id):Array.from(row.parentElement!.querySelectorAll<HTMLElement>(`[data-translation-track="${CSS.escape(trackId)}"] [data-translation-id]`)).map(node=>node.dataset.translationId!);
    const shift=event.shiftKey,toggle=event.ctrlKey||event.metaKey;
    const ids=!shift&&!toggle&&previous?.ids.includes(id)?previous.ids:selectIds(order,previous?.ids??[],previous?.anchorId??id,id,shift,toggle);
    shared?.setSelection({kind,attachment:'translation',lineId:item.lineId,trackId,contentId:item.id,ids,activeId:id,anchorId:shift||toggle||previous?.ids.includes(id)?previous?.anchorId??id:id});
  };
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
    if (composing.current) return;
    if (fresh && draft.kind === 'plain' && !draft.text.trim()) { remove(); return; }
    if (JSON.stringify(draft) === JSON.stringify(item)) return;
    try { commit(draft); setError(''); } catch (cause) { setError((cause as Error).message); }
  };
  return <div data-translation-id={item.id} tabIndex={0} data-selected={selected?.kind==='romanization-content'&&selected.attachment==='translation'&&selected.ids.includes(item.id)||undefined} className={styles.translationRow} onClick={event=>choose(event)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if(event.target===event.currentTarget&&(event.key===' '||event.key==='Enter')){event.preventDefault();choose(event);return;}
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLElement).blur(); }
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(item); setError(''); (event.target as HTMLElement).blur(); if (fresh) remove(); }
  }}>
    {draft.kind === 'plain' ? <textarea ref={textRef} rows={1} autoFocus={fresh} aria-label={`翻译 ${index + 1}`} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} onBlur={submit} /> : <div><small>定时翻译</small>{draft.units.map((unit, unitIndex) => <div key={unit.id} data-translation-unit-id={unit.id} tabIndex={0} data-selected={selected?.kind==='romanization-unit'&&selected.attachment==='translation'&&selected.ids.includes(unit.id)||undefined} onClick={event=>choose(event,unit.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key===' '||event.key==='Enter')){event.preventDefault();choose(event,unit.id);}}}>
      <input aria-label={`翻译 ${index + 1} 单元 ${unitIndex + 1}`} value={unit.text} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, text: event.target.value } : value) })} onBlur={submit} />
      {(['beginMs', 'endMs'] as const).map(side => <input key={side} type="number" min="0" step="1" placeholder="未定" aria-label={`翻译 ${index + 1} 单元 ${unitIndex + 1} ${side === 'beginMs' ? '开始' : '结束'}毫秒`} value={unit[side] ?? ''} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, [side]: event.target.value === '' ? null : Number(event.target.value) } : value) })} onBlur={submit} />)}
    </div>)}</div>}
    <button data-role="danger" className={`icon-button ${styles.iconButton}`} aria-label="删除翻译" onMouseDown={event => event.preventDefault()} onClick={remove}><Icon name="trash" /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
export function TranslationEditor({ document, lineId, apply }: { document: LyricDocument; lineId: string; apply: (command: LyricCommand) => boolean }) {
  const [adding, setAdding] = useState<TranslationContent | null>(null);
  const [trackId, setTrackId] = useState(document.translationTracks[0]?.id ?? '');
  const invalidTarget = Boolean(trackId) && !document.translationTracks.some(track => track.id === trackId);
  const targetId = invalidTarget && adding ? '' : document.translationTracks.some(track => track.id === trackId) ? trackId : document.translationTracks[0]?.id ?? '';
  useEffect(() => { if (!adding || !trackId) setTrackId(targetId); }, [targetId, adding, trackId]);
  const shared = useEditorSelection();
  const items = document.translationTracks.flatMap((track, index) => track.contents.filter(content => content.lineId === lineId).map(content => ({ track, index, content })));
  const submit = (tracks: TranslationTrack[]) => apply({ type: 'set-translation-tracks', source: document.translationTracks, tracks });
  return <div className={styles.sublyrics}><div>
    <div className={styles.translationToolbar}><strong>翻译</strong>
    <label>新增到 <Select aria-label="新增翻译的轨道" value={targetId} onChange={event => setTrackId(event.target.value)}>{!document.translationTracks.length ? <option value="">新建轨道</option> : <option value="" disabled>请选择轨道</option>}{document.translationTracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
    <button data-role="inline" className="icon-button" aria-label="新增翻译" title="新增翻译" data-tooltip="新增翻译" disabled={Boolean(adding)} onClick={() => setAdding(plainTranslation('', lineId))}><Icon name="add"/></button>
    {adding && invalidTarget && <small role="alert">原轨道已删除，草稿保留，请重新选择轨道。</small>}
    </div>
    {items.map(({ track, index: trackIndex, content }, index) => <div key={content.id} data-translation-track={track.id}>
      <small>{translationTrackLabel(track, trackIndex)}</small>
      <TranslationRow item={content} index={index} commit={next => submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.map(item => item.id === content.id ? next : item) }))}
        remove={() => submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.filter(item => item.id !== content.id) }))} />
    </div>)}
    {adding && <TranslationRow item={adding} index={items.length} fresh remove={() => setAdding(null)} commit={content => { if (invalidTarget || document.translationTracks.length && !targetId) throw new Error('请重新选择轨道后提交');
      if (!document.lines.some(line => line.id === lineId)) throw new Error('原行已不存在，未提交');
      const nextTrack = targetId || crypto.randomUUID();
      const insert: LyricCommand = { type: 'insert-translation-content', trackId: nextTrack, content };
      const command: LyricCommand = targetId ? insert : { type: 'set-translation-tracks', source: document.translationTracks, tracks: [{ id: nextTrack, language: null, purpose: 'subtitle', contents: [content] }] };
      if (apply(command)) { setTrackId(nextTrack); setAdding(null); } else throw new Error('提交失败，草稿已保留'); }} />}

  </div></div>;
}
