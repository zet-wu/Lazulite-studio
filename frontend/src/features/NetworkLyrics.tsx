import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Source } from '../adapters/http/lyric-sources';
import type { AcquisitionStore, CandidateRecord } from '../acquisition-store';
import type { useSearchConditions } from './useSearchConditions';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import styles from './acquisition.module.css';
export const checkLabels: Record<CandidateRecord['status'],string> = { pending: '等待取词', fetching: '取词中', parsing: '解析中', ready: '', partial: '附属行出错', 'fetch-failed': '获取失败', 'decode-failed': '解码失败', 'parse-failed': '正文解析失败', empty: '无歌词' };
export function NetworkLyrics({ store, searchConditions, source, document, apply }: { store: AcquisitionStore; searchConditions: ReturnType<typeof useSearchConditions>; source: Source; document: LyricDocument; apply: (c: LyricCommand) => void }) {
 const snapshot = useSyncExternalStore(store.subscribe,store.getSnapshot), state = snapshot.sources[source];
 const [message,setMessage] = useState('');
 const list = useRef<HTMLDivElement>(null), pointer = useRef(false);
 const selected = state.selected ? state.records[state.selected]?.candidate : null;
 useEffect(() => { if (searchConditions.ready) store.ensureSearch(searchConditions.values); }, [store,searchConditions.ready]);
 useEffect(() => () => store.setInteracting(source,false), [store,source]);
 const id = selected?.source === 'netease' ? selected.id : selected?.source === 'qqmusic' ? selected.songmid : null;
 const key = source === 'netease' ? 'ncmMusicId' : 'qqMusicId';
 const link = () => {
   if (!id) return;
   const old = document.metadata[key] ?? [];
   if (old.includes(id)) { setMessage('此歌曲 ID 已关联'); return; }
   try { apply({ type: 'set-metadata', key, values: [...old,id] }); setMessage('歌曲 ID 已关联，可撤销'); }
   catch (e) { setMessage(e instanceof Error ? e.message : '关联失败'); }
 };
 const changed = snapshot.query && (Object.keys(snapshot.query) as (keyof typeof snapshot.query)[]).some(k=>snapshot.query![k] !== searchConditions.values[k]);
 return <>
 <form className={styles.searchFields} onSubmit={e=>{e.preventDefault();store.search(searchConditions.values);setMessage('');}}>
 {(['title','artist','album'] as const).map((field,i)=><label key={field}>{['标题','艺术家','专辑'][i]}<input aria-label={['搜索标题','搜索艺术家','搜索专辑'][i]} maxLength={2000} disabled={!searchConditions.ready} value={searchConditions.values[field]} onChange={e=>searchConditions.change(field,e.target.value)} /></label>)}
 <button data-role="secondary" disabled={!searchConditions.ready || !searchConditions.values.title.trim()}>搜索</button></form>
 {searchConditions.error && <p role="alert">{searchConditions.error} <button data-role="secondary" onClick={()=>void searchConditions.retry()}>重试保存条件</button></p>}
 {changed && <p className={styles.hint}>当前结果属于上次搜索：{snapshot.query!.title}。点击搜索更新四源结果。</p>}
 <div className={styles.sourceStates} aria-label="四源搜索状态">{(['netease','qqmusic','kugou','amll'] as Source[]).map((s,i)=>{const item=snapshot.sources[s];return <span key={s}>{['网易','QQ','酷狗','AMLL'][i]}：{item.pending ? `搜索中 ${item.rows.length}` : item.failed.length ? `${item.succeeded ? '部分失败' : '搜索失败'} ${item.rows.length}` : item.cancelled ? `已取消 ${item.rows.length}` : snapshot.query ? `${item.rows.length} 条` : '未搜索'}</span>;})}</div>
 {Object.values(snapshot.sources).some(s=>s.pending>0) && <button data-role="secondary" onClick={()=>store.cancelSearch()}>取消搜索</button>}
 <div ref={list} className={styles.results} aria-label="歌曲候选" onPointerEnter={()=>{pointer.current=true;store.setInteracting(source,true);}} onPointerLeave={()=>{pointer.current=false;if(!list.current?.contains(window.document.activeElement))store.setInteracting(source,false);}} onFocusCapture={()=>store.setInteracting(source,true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget) && !pointer.current)store.setInteracting(source,false);}}>
 {state.rows.map(id=>{const record=state.records[id],c=record.candidate; const status=checkLabels[record.status],failed=['fetch-failed','decode-failed','parse-failed','empty'].includes(record.status); return <button data-role="secondary" key={id} aria-pressed={state.selected===id} onClick={()=>{store.select(source,id);setMessage('');}}>
 <strong>{c.title}</strong><small>{c.artists.join(' / ')}{c.album && ` · ${c.album}`}{c.duration_ms ? ` · ${(c.duration_ms/1000).toFixed(0)} 秒` : ''}</small>
 <span className={styles.badges}>{record.badges.map(b=><span key={b} className={styles.badgeBlue}>{b}</span>)}{status && <span className={failed ? styles.badgeRed : styles.badgeYellow}>{status}</span>}</span>
 </button>;})}</div>
 {state.failed.length>0 && <p role="status">{state.succeeded ? '部分搜索请求失败，已保留结果。' : '搜索失败。'} <button data-role="secondary" onClick={()=>store.retrySearch(source)}>重试此来源</button></p>}
 {!state.pending && !state.failed.length && !state.cancelled && snapshot.query && !state.rows.length && <p>没有搜索结果</p>}
 <div className={styles.actions}><button data-role="secondary" disabled={!id} onClick={link}>仅关联歌曲 ID</button>{selected && <button data-role="secondary" onClick={()=>store.refresh(source,selected.id)}>重新取词</button>}</div>
 {message && <p role="status">{message}</p>}
 {!id && <p className={styles.hint}>{source === 'kugou' ? '酷狗不支持歌曲 ID 关联。' : source === 'amll' ? 'AMLL TTML 中已有的平台元数据由右侧表格选择。' : selected ? '候选缺少已确认的平台 ID，不能关联。' : '先选择歌曲候选。'}</p>}
 </>;
}
