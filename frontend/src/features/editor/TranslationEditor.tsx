import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage, MessageError } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
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
  useTranslation();
  const shared = useEditorSelection();
  const selected = shared?.selection;
  const choose = (event: {currentTarget:HTMLElement;stopPropagation:()=>void;shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean}, unitId?: string, focus = false) => {
    event.stopPropagation();
    const row=event.currentTarget.closest<HTMLElement>('[data-translation-track]')!;
    const trackId=row.dataset.translationTrack!;
    const id=unitId??item.id, kind=unitId?'romanization-unit' as const:'romanization-content' as const;
    const previous=selected?.kind===kind&&selected.attachment==='translation'?selected:null;
    const order=unitId&&item.kind==='timed'?item.units.map(unit=>unit.id):Array.from(row.parentElement!.querySelectorAll<HTMLElement>(`[data-translation-track="${CSS.escape(trackId)}"] [data-translation-id]`)).map(node=>node.dataset.translationId!);
    const shift=!!event.shiftKey,toggle=!!(event.ctrlKey||event.metaKey);
    if (focus && previous?.ids.includes(id)) return;
    const ids=selectIds(order,previous?.ids??[],previous?.anchorId??id,id,shift,toggle);
    shared?.setSelection({kind,attachment:'translation',lineId:item.lineId,trackId,contentId:item.id,ids,activeId:id,anchorId:shift||toggle?previous?.anchorId??id:id});
  };
  const [draft, setDraft] = useState(item);
  const [error, setError] = useMessageText('');
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
    try { commit(draft); setError(''); } catch (cause) { setError(errorMessage(cause)); }
  };
  return <div data-translation-id={item.id} tabIndex={0} data-selected={selected?.kind==='romanization-content'&&selected.attachment==='translation'&&selected.ids.includes(item.id)||undefined} className={styles.translationRow} onFocusCapture={event=>{if(!fresh && !(event.target as Element).closest('[data-pointer-focus], [data-selection-focus]') && (event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement))choose(event,event.target.closest<HTMLElement>('[data-translation-unit-id]')?.dataset.translationUnitId,true);}} onClick={event=>{if ((event.target as Element).closest('button')) return; choose(event); if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.currentTarget.focus({preventScroll:true});}} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if(event.target===event.currentTarget&&(event.key===' '||event.key==='Enter')){event.preventDefault();choose(event);return;}
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLElement).blur(); }
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(item); setError(''); (event.target as HTMLElement).blur(); if (fresh) remove(); }
  }}>
    {draft.kind === 'plain' ? <textarea ref={textRef} rows={1} autoFocus={fresh} aria-label={t('translation.inputLabel',{number:index+1})} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} onBlur={submit} /> : <div><small>{t('translation.timed')}</small>{draft.units.map((unit, unitIndex) => <div key={unit.id} data-translation-unit-id={unit.id} tabIndex={0} data-selected={selected?.kind==='romanization-unit'&&selected.attachment==='translation'&&selected.ids.includes(unit.id)||undefined} onClick={event=>{choose(event,unit.id);if (!(event.target instanceof HTMLInputElement)) event.currentTarget.focus({preventScroll:true});}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key===' '||event.key==='Enter')){event.preventDefault();choose(event,unit.id);}}}>
      <input aria-label={t('translation.unitLabel',{number:index+1,unit:unitIndex+1})} value={unit.text} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, text: event.target.value } : value) })} onBlur={submit} />
      {(['beginMs', 'endMs'] as const).map(side => <input key={side} type="number" min="0" step="1" placeholder={t('ruby.untimed')} aria-label={t('translation.timeLabel',{number:index+1,unit:unitIndex+1,side:t(side==='beginMs'?'time.begin':'time.end')})} value={unit[side] ?? ''} onChange={event => setDraft({ ...draft, units: draft.units.map(value => value.id === unit.id ? { ...value, [side]: event.target.value === '' ? null : Number(event.target.value) } : value) })} onBlur={submit} />)}
    </div>)}</div>}
    <button data-role="danger" className={`icon-button ${styles.iconButton}`} aria-label={t('translation.delete')} onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); remove(); }}><Icon name="trash" /></button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
export function TranslationEditor({ document, lineId, apply }: { document: LyricDocument; lineId: string; apply: (command: LyricCommand) => boolean }) {
  useTranslation();
  const [adding, setAdding] = useState<TranslationContent | null>(null);
  const [trackId, setTrackId] = useState(document.translationTracks[0]?.id ?? '');
  const invalidTarget = Boolean(trackId) && !document.translationTracks.some(track => track.id === trackId);
  const targetId = invalidTarget && adding ? '' : document.translationTracks.some(track => track.id === trackId) ? trackId : document.translationTracks[0]?.id ?? '';
  useEffect(() => { if (!adding || !trackId) setTrackId(targetId); }, [targetId, adding, trackId]);
  const shared = useEditorSelection();
  const items = document.translationTracks.flatMap((track, index) => track.contents.filter(content => content.lineId === lineId).map(content => ({ track, index, content })));
  const submit = (tracks: TranslationTrack[]) => apply({ type: 'set-translation-tracks', source: document.translationTracks, tracks });
  return <div className={styles.sublyrics}><div>
    <div className={styles.translationToolbar}><strong>{t('capability.translation')}</strong>
    <label>{t('translation.addTo')}<Select aria-label={t('translation.addTrackLabel')} value={targetId} onChange={event => setTrackId(event.target.value)}>{!document.translationTracks.length ? <option value="">{t('translation.newTrack')}</option> : <option value="" disabled>{t('translation.chooseTrack')}</option>}{document.translationTracks.map((track, index) => <option key={track.id} value={track.id}>{translationTrackLabel(track, index)}</option>)}</Select></label>
    <button data-role="inline" className="icon-button" aria-label={t('translation.add')} title={t('translation.add')} data-tooltip={t('translation.add')} disabled={Boolean(adding)} onClick={() => setAdding(plainTranslation('', lineId))}><Icon name="add"/></button>
    {adding && invalidTarget && <small role="alert">{t('translation.trackRemoved')}</small>}
    </div>
    {items.map(({ track, index: trackIndex, content }, index) => <div key={content.id} data-translation-track={track.id}>
      <small>{translationTrackLabel(track, trackIndex)}</small>
      <TranslationRow item={content} index={index} commit={next => submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.map(item => item.id === content.id ? next : item) }))}
        remove={() => { const target = {kind:'romanization-content' as const,attachment:'translation' as const,lineId,trackId:track.id,contentId:content.id,ids:[content.id],activeId:content.id,anchorId:content.id}; if (shared?.commands.current) { shared.area.current = 'canvas'; shared.commands.current.remove(target); } else submit(document.translationTracks.map(value => value.id !== track.id ? value : { ...value, contents: value.contents.filter(item => item.id !== content.id) })); }} />
    </div>)}
    {adding && <TranslationRow item={adding} index={items.length} fresh remove={() => setAdding(null)} commit={content => { if (invalidTarget || document.translationTracks.length && !targetId) throw new MessageError(describeMessage('translation.reselect'));
      if (!document.lines.some(line => line.id === lineId)) throw new MessageError(describeMessage('translation.lineRemoved'));
      const nextTrack = targetId || crypto.randomUUID();
      const insert: LyricCommand = { type: 'insert-translation-content', trackId: nextTrack, content };
      const command: LyricCommand = targetId ? insert : { type: 'set-translation-tracks', source: document.translationTracks, tracks: [{ id: nextTrack, language: null, purpose: 'subtitle', contents: [content] }] };
      if (apply(command)) { setTrackId(nextTrack); setAdding(null); } else throw new MessageError(describeMessage('translation.failed')); }} />}

  </div></div>;
}

const t=i18n.t.bind(i18n);
