import { collectOutputIssues, uniqueOutputIssues, DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { jobsApi } from '../adapters/http/jobs';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publishingApi } from '../adapters/http/publishing';
import { requestHeaders } from '../adapters/http/client';
import { renderLrc, type LrcKind } from '../adapters/lrc';
import type { LyricDocument } from '../domain/lyric-document';
import { validatePublishDocument } from '../adapters/publish-validation';
import styles from './acquisition.module.css';
type Info = { filename: string; format_label: string; asset_id: string; supported: boolean; container: string | null; tracks: { track_id: number; language: string; name: string }[]; error: string | null };
const active = new Set(['queued','running','processing','cancel_requested']);
export function MusicPackaging({ projectId, document, saveForPackaging, onIssues }: { onIssues: (issues: OutputIssue[])=>void; projectId: string; document: LyricDocument; saveForPackaging: () => Promise<{ revision: string; document: LyricDocument } | undefined> }) {
 const client = useQueryClient();
 const info = useQuery({ queryKey:['packaging',projectId], queryFn:async (): Promise<Info> => { const r=await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/packaging`,{headers:requestHeaders(),credentials:'include'}); if (!r.ok) throw new Error('无法读取源文件打包信息'); return r.json(); } });
 const exports = useQuery({ queryKey:['exports',projectId], queryFn:()=>publishingApi.list(projectId), refetchInterval:q=>q.state.data?.items.some(i=>active.has(i.status)) ? 1500 : false });
 const [kind,setKind] = useState<LrcKind>('lrc'), [track,setTrack] = useState<number | null>(null), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
 useEffect(()=>{onIssues([]);},[kind,track,document,onIssues]);
 const [captured,setCaptured] = useState<LyricDocument | null>(null);
 const publish = async () => {
   if (!info.data || busy) return;
   setBusy(true); setMessage(''); onIssues([]);
   try {
     const snapshot = document, target = track, asset = info.data.asset_id;
     const problems=[...collectOutputIssues(snapshot,kind),...(info.data.container === 'mp4' ? collectOutputIssues(snapshot,'publish') : [])];
     const unique=uniqueOutputIssues(problems);
     if(unique.length)throw new DocumentOutputError(unique);
     const lrc=renderLrc(snapshot,kind).text;
     if (info.data.container === 'mp4') validatePublishDocument(snapshot);
     const saved = await saveForPackaging();
     if (!saved || saved.document !== snapshot) throw new Error('保存快照已变化，请重新发起打包');
     setCaptured(snapshot);
     await publishingApi.publish(projectId,saved.revision,asset,{lrc_kind:kind,lrc_text:lrc,target_track_id:target});
     setMessage(`已提交打包，修订 ${saved.revision}`); await client.invalidateQueries({queryKey:['exports',projectId]});
   } catch(e) { if(e instanceof DocumentOutputError)onIssues(uniqueOutputIssues(e.issues));else setMessage(e instanceof Error ? e.message : '打包失败'); }
   finally { setBusy(false); }
 };
 return <>
 {info.data && <><p>源文件：{info.data.filename} · {info.data.format_label}</p><p className={styles.hint}>{info.data.container === 'mp4' ? `TTML → STPP 歌词轨道；${kind === 'elrc' ? '扩展' : '普通'} LRC → 歌词标签。${info.data.tracks.length ? track ? `覆盖轨道 ${track}` : '请选择覆盖轨道' : '新增 STPP 轨道'}` : info.data.container === 'mp3' ? 'LRC → ID3 USLT 歌词标签' : info.data.container === 'flac' ? 'LRC → FLAC LYRICS 歌词标签' : '此格式不支持打包'}。生成副本，不转码。</p></>}

 <label>内嵌歌词 <select value={kind} onChange={e=>setKind(e.target.value as LrcKind)}><option value="lrc">普通 LRC</option><option value="elrc">扩展 LRC（尖括号）</option></select></label>
 {info.data?.container === 'mp3' && <p className={styles.hint}>目标：USLT，语言 eng，空描述；其他语言／描述保留。</p>}
 {info.data?.tracks.length ? <label>覆盖 STPP 轨道 <select aria-label="覆盖 STPP 轨道" value={track ?? ''} onChange={e=>setTrack(e.target.value ? Number(e.target.value) : null)}><option value="">请选择目标轨道</option>{info.data.tracks.map(t=><option key={t.track_id} value={t.track_id}>{t.track_id} · {t.language} · {t.name || '未命名'}</option>)}</select></label> : info.data?.container === 'mp4' ? <p className={styles.hint}>源文件没有 STPP，将新增歌词轨道。</p> : null}
 {info.isError && <p role="alert">读取失败 <button onClick={()=>void info.refetch()}>重试</button></p>}
 {info.data && !info.data.supported && <p role="alert">{info.data.error ?? '源音频格式不支持打包；可下载歌词文件。'}</p>}
 <button onClick={()=>void publish()} disabled={busy || !info.data?.supported || Boolean(info.data.tracks.length && !track)}>{busy ? '保存并提交中…' : '保存并打包'}</button>
 {message && <p role="status">{message}</p>}{captured && captured !== document && <p>当前歌词有较新修改，已提交任务使用之前捕获的修订。</p>}
 <h2>历史产物</h2>{exports.isError && <p>记录读取失败 <button onClick={()=>void exports.refetch()}>重试</button></p>}
 {exports.data?.items.map(item=>{
   const passed=item.status==='succeeded' && item.report?.passed===true;
   const label=item.lrc_kind==='elrc' ? '扩展 LRC' : '普通 LRC';
   const result=active.has(item.status) ? '正在打包' : passed && item.report?.subtitle_codec==='stpp' ? `已写入 STPP · ${label}` : passed && item.report?.lyrics_preserved ? `已写入 ${label}` : item.status==='failed' ? '打包失败' : item.status==='cancelled' ? '已取消' : item.status==='unavailable' ? '产物不可用' : item.status==='interrupted' ? '打包中断' : item.status;
   return <article key={item.id}><p>{item.asset_filename ?? '未记录源文件名'} · {item.format_label ?? '格式待确认'} · {result}{item.track_id ? ` · STPP 轨道 ${item.track_id}` : ''}</p><p className={styles.hint}>修订 {item.revision}{item.stale ? ' · 旧修订' : ''}{item.filename ? ` · ${item.filename}` : ''}</p>
   {item.download_url && <a href={item.download_url}>下载音乐文件</a>}{active.has(item.status) && <button onClick={()=>void jobsApi.cancel(item.id).then(()=>client.invalidateQueries({queryKey:['exports',projectId]})).catch(e=>setMessage(e.message))}>取消任务</button>}<details><summary>回读报告</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(item.error ?? item.report,null,2)}</pre></details></article>;
 })}
 {!exports.data?.items.length && <p className={styles.hint}>还没有打包产物。</p>}
 </>;
}
