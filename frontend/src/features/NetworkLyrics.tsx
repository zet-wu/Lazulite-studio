import { useEffect, useRef, useState } from 'react';
import { parsePayload, sourceRequest, type Candidate, type Payload, type Source } from '../adapters/http/lyric-sources';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import styles from './acquisition.module.css';
export function NetworkLyrics({ source, document, apply, stage, clear }: { source: Source; document: LyricDocument; apply: (c: LyricCommand) => void; stage: (d: LyricDocument) => void; clear: () => void }) {
 const [query, setQuery] = useState(() => [...(document.metadata.musicName ?? []), ...(document.metadata.artists ?? [])].join(' '));
 const [rows, setRows] = useState<Candidate[]>([]), [selected, setSelected] = useState<Candidate | null>(null);
 const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false);
 const [badges, setBadges] = useState<Record<string, string[]>>({});
 const pending = useRef<AbortController | null>(null), serial = useRef(0);
 useEffect(() => () => { ++serial.current; pending.current?.abort(); }, []);
 const invalidate = () => { ++serial.current; pending.current?.abort(); setBusy(false); clear(); };
 const search = async () => {
   invalidate(); const current = serial.current, controller = new AbortController(); pending.current = controller;
   setRows([]); setSelected(null); setBusy(true); setMessage(''); setSearched(false);
   try { const result = await sourceRequest<{ items: Candidate[] }>('search', { source, query }, controller.signal); if (serial.current === current) { setRows(result.items); setSearched(true); } }
   catch (e) { if (serial.current === current) setMessage(`搜索失败：${e instanceof Error ? e.message : e}`); }
   finally { if (serial.current === current) setBusy(false); }
 };
 const fetchCandidate = async (c: Candidate) => {
   invalidate(); const current = serial.current, controller = new AbortController(); pending.current = controller;
   setSelected(c); setBusy(true); setMessage('');
   if (source === 'qqmusic' && !c.songmid) void sourceRequest<Candidate>('resolve', c, controller.signal).then(resolved => { if (serial.current === current) setSelected(resolved); }).catch(e => { if (serial.current === current) setMessage(`歌曲 ID 补查失败：${e.message}`); });
   try {
     const payload = await sourceRequest<Payload>('fetch', c, controller.signal);
     if (serial.current !== current) return;
     if (payload.empty) { setMessage('此候选没有可用歌词，仍可关联已确认的歌曲 ID。'); return; }
     const parsed = parsePayload(payload); stage(parsed.document); setBadges(old => ({ ...old, [c.id]: parsed.badges }));
   } catch (e) { if (serial.current === current) setMessage(`取词或解析失败：${e instanceof Error ? e.message : e}`); }
   finally { if (serial.current === current) setBusy(false); }
 };
 const id = selected?.source === 'netease' ? selected.id : selected?.source === 'qqmusic' ? selected.songmid : null;
 const key = source === 'netease' ? 'ncmMusicId' : 'qqMusicId';
 const link = () => {
   if (!id) return;
   const old = document.metadata[key] ?? [];
   if (old.includes(id)) { setMessage('此歌曲 ID 已关联'); return; }
   try { apply({ type: 'set-metadata', key, values: [...old, id] }); setMessage('歌曲 ID 已关联，可撤销'); }
   catch (e) { setMessage(e instanceof Error ? e.message : '关联失败'); }
 };
 return <><form className={styles.actions} onSubmit={e => { e.preventDefault(); void search(); }}><input aria-label="搜索歌曲" value={query} onChange={e => { invalidate(); setQuery(e.target.value); setRows([]); setSelected(null); setSearched(false); }} /><button disabled={!query.trim()}>搜索</button></form>
 <p className={styles.hint}>在线获取需要已认证服务。选择候选后读取实际歌词属性。</p>
 <div className={styles.results}>{rows.map(c => <button key={c.id} aria-pressed={selected?.id === c.id} onClick={() => void fetchCandidate(c)}>{c.title}<small>{c.artists.join(' / ')} · {c.album}{c.duration_ms ? ` · ${(c.duration_ms / 1000).toFixed(0)} 秒` : ''}</small><small>{badges[c.id]?.join(' · ') ?? '尚未获取歌词'}</small></button>)}</div>
 {busy && <p role="status">正在请求… <button onClick={invalidate}>取消请求</button></p>}{searched && !rows.length && <p>没有搜索结果</p>}{message && <p role="status">{message}</p>}
 <div className={styles.actions}><button disabled={!id} onClick={link}>仅关联歌曲 ID</button>{selected && <button onClick={() => void fetchCandidate(selected)}>重新取词</button>}</div>
 {!id && <p className={styles.hint}>{source === 'kugou' ? '酷狗不支持歌曲 ID 关联。' : source === 'amll' ? 'AMLL TTML 中已有的平台元数据由右侧表格选择。' : selected ? '候选缺少已确认的平台 ID，不能关联。' : '先选择歌曲候选。'}</p>}
 </>;
}
