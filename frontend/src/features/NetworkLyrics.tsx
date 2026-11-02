import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage, isMessage, type Message } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../shared/Controls';
import { LyricCandidate } from './LyricCandidate';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Source } from '../adapters/http/lyric-sources';
import type { AcquisitionStore, CandidateRecord } from '../acquisition-store';
import type { useSearchConditions } from './useSearchConditions';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import styles from './acquisition.module.css';
export const checkLabels: Record<CandidateRecord['status'],string> = { pending: 'search.waitingLyrics', fetching: 'search.fetchingLyrics', parsing: 'search.parsing', ready: '', partial: 'search.attachmentError', 'fetch-failed': 'search.fetchFailed', 'decode-failed': 'search.decodeFailed', 'parse-failed': 'search.parseFailed', empty: 'search.noLyrics' };
export function NetworkLyrics({ store, searchConditions, source, document, apply }: { store: AcquisitionStore; searchConditions: ReturnType<typeof useSearchConditions>; source: Source; document: LyricDocument; apply: (c: LyricCommand) => void }) {
  useTranslation();
 const snapshot = useSyncExternalStore(store.subscribe,store.getSnapshot), state = snapshot.sources[source];
 const [message,setMessage] = useMessageText('');
 const list = useRef<HTMLDivElement>(null), pointer = useRef(false);
 const selected = state.selected ? state.records[state.selected]?.candidate : null;
 useEffect(() => { if (searchConditions.ready) store.ensureSearch(searchConditions.values); }, [store,searchConditions.ready]);
 useEffect(() => () => store.setInteracting(source,false), [store,source]);
 const id = selected?.source === 'netease' ? selected.id : selected?.source === 'qqmusic' ? selected.songmid : null;
 const key = source === 'netease' ? 'ncmMusicId' : 'qqMusicId';
 const link = () => {
   if (!id) return;
   const old = document.metadata[key] ?? [];
   if (old.includes(id)) { setMessage(describeMessage('search.alreadyLinked')); return; }
   try { apply({ type: 'set-metadata', key, values: [...old,id] }); setMessage(describeMessage('search.linked')); }
   catch (e) { setMessage(errorMessage(e)); }
 };
 const changed = snapshot.query && (Object.keys(snapshot.query) as (keyof typeof snapshot.query)[]).some(k=>snapshot.query![k] !== searchConditions.values[k]);
 return <>
 <form className={styles.searchFields} onSubmit={e=>{e.preventDefault();store.search(searchConditions.values);setMessage('');}}>
 {(['title','artist','album'] as const).map((field,i)=><label key={field}>{[t('search.title'),t('search.artist'),t('search.album')][i]}<input aria-label={[t('search.titleInput'),t('search.artistInput'),t('search.albumInput')][i]} maxLength={2000} disabled={!searchConditions.ready} value={searchConditions.values[field]} onChange={e=>searchConditions.change(field,e.target.value)} /></label>)}
 <button type="button" data-role="secondary" aria-label={t('search.fillMetadata')} style={{minWidth:'10em'}} title={searchConditions.hasSource?t('search.replaceConditions'):t('alignment.uploadRequired')} data-tooltip={searchConditions.hasSource?t('search.replaceConditions'):t('alignment.uploadRequired')} disabled={!searchConditions.ready||!searchConditions.hasSource||searchConditions.readingMetadata} aria-busy={searchConditions.readingMetadata} onClick={()=>void searchConditions.fillMetadata()}>{searchConditions.readingMetadata?t('common.reading'):t('search.fillMetadata')}</button>
 <IconButton icon="search" label={t('search.submit')} type="submit" data-role="primary" disabled={!searchConditions.ready || !searchConditions.values.title.trim()}/></form>
 {searchConditions.metadataError&&<p role="alert">{searchConditions.metadataError}</p>}
 {searchConditions.error && <p role="alert">{searchConditions.error} <IconButton icon="refresh" label={t('search.retryConditions')} data-role="secondary" onClick={()=>void searchConditions.retry()}/></p>}
 {changed && <p className={styles.hint}>{t('search.previousResults',{title:snapshot.query!.title})}</p>}
 <div className={styles.sourceStates} aria-label={t('search.sourceStatus')}>{(['netease','qqmusic','kugou','amll'] as Source[]).map((s,i)=>{const item=snapshot.sources[s];return <span key={s}>{[t('source.neteaseShort'),'QQ',t('source.kugou'),'AMLL'][i]}：{item.pending ? t('search.runningCount',{count:item.rows.length}) : item.failed.length ? `${item.succeeded ? t('search.partial') : t('search.failed')} ${item.rows.length}` : item.cancelled ? t('search.cancelledCount',{count:item.rows.length}) : snapshot.query ? t('search.resultCount',{count:item.rows.length}) : t('search.notStarted')}</span>;})}</div>
 {Object.values(snapshot.sources).some(s=>s.pending>0) && <button data-role="secondary" onClick={()=>store.cancelSearch()}>{t('search.cancel')}</button>}
 <div ref={list} className={styles.results} aria-label={t('search.candidates')} onPointerEnter={()=>{pointer.current=true;store.setInteracting(source,true);}} onPointerLeave={()=>{pointer.current=false;if(!list.current?.contains(window.document.activeElement))store.setInteracting(source,false);}} onFocusCapture={()=>store.setInteracting(source,true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget) && !pointer.current)store.setInteracting(source,false);}}>
 {state.rows.map(id=>{const record=state.records[id],c=record.candidate; const status=t(checkLabels[record.status]),failed=['fetch-failed','decode-failed','parse-failed','empty'].includes(record.status); return <LyricCandidate key={id} selected={state.selected===id} onSelect={()=>{store.select(source,id);setMessage('');}}
 title={c.title} detail={<>{c.artists.join(' / ')}{c.album && ` · ${c.album}`}{c.duration_ms ? ' · '+t('search.duration',{seconds:(c.duration_ms/1000).toFixed(0)}) : ''}</>}
 badges={record.badges} status={status} failed={failed}/>
 ;})}</div>
 {state.failed.length>0 && <p role="status">{state.succeeded ? t('search.partialHelp') : t('search.failedHelp')} <IconButton icon="refresh" label={t('search.retrySource')} data-role="secondary" onClick={()=>store.retrySearch(source)}/></p>}
 {!state.pending && !state.failed.length && !state.cancelled && snapshot.query && !state.rows.length && <p>{t('search.empty')}</p>}
 <div className={styles.actions}><button data-role="secondary" disabled={!id} onClick={link}>{t('search.linkOnly')}</button><button data-role="secondary" disabled={!selected} onClick={()=>{if(selected)store.refresh(source,selected.id);}}>{t('search.refetch')}</button>
 {!id && (source === 'kugou' || source === 'amll' || selected) && <span className={styles.hint}>{source === 'kugou' ? t('search.kugouNoLink') : source === 'amll' ? t('search.choosePlatformId') : t('search.unconfirmedId')}</span>}</div>
 {message && <p role="status">{message}</p>}
 </>;
}

const t=i18n.t.bind(i18n);
