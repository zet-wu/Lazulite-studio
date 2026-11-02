import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../shared/Controls';
import { Disclosure } from '../shared/Disclosure';
import { useProjectEditing } from './editor/ProjectEditingContext';
import type { ProjectEditing } from '../domain/project-editing';
import { Select } from '../shared/Select';
import { usePreference } from './editor/use-preference';
import { uniqueOutputIssues, DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { jobsApi } from '../adapters/http/jobs';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publishingApi } from '../adapters/http/publishing';
import { requestHeaders } from '../adapters/http/client';
import { exportLyricFile } from '../adapters/lyric-formats';
type PackagingLrcKind = 'none' | 'lrc' | 'elrc';
import type { LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
type Info = { filename: string; format_label: string; asset_id: string; supported: boolean; container: string | null; tracks: { track_id: number; language: string; name: string }[]; error: string | null };
const active = new Set(['queued','running','processing','cancel_requested']);
export function MusicPackaging({ projectId, document, saveForPackaging, onIssues, dirty }: { dirty?: boolean; onIssues: (issues: OutputIssue[])=>void; projectId: string; document: LyricDocument; saveForPackaging: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined> }) {
  useTranslation();
 const editing = useProjectEditing();
 const client = useQueryClient();
 const info = useQuery({ queryKey:['packaging',projectId], queryFn:async (): Promise<Info> => { const r=await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/packaging`,{headers:requestHeaders(),credentials:'include'}); if (!r.ok) throw new MessageError(describeMessage('packaging.readSourceFailed')); return r.json(); } });
 const exports = useQuery({ queryKey:['exports',projectId], queryFn:()=>publishingApi.list(projectId), refetchInterval:q=>q.state.data?.items.some(i=>active.has(i.status)) ? 1500 : false });
 const [kind,setKind] = usePreference<PackagingLrcKind>(`studio:packaging:project:${projectId}`, 'lrc', (v): v is PackagingLrcKind => v === 'none' || v === 'lrc' || v === 'elrc'), [track,setTrack] = useState<number | null>(null), [busy,setBusy] = useState(false), [message,setMessage] = useMessageText('');
 useEffect(()=>{onIssues([]);},[kind,track,document,editing,onIssues]);
 useEffect(()=>{if(info.data&&info.data.container!=='mp4'&&kind==='none')setKind('lrc');},[info.data,kind,setKind]);
 const [captured,setCaptured] = useState<LyricDocument | null>(null);
 const recent=exports.data?.items.find(item=>item.status==='succeeded' && item.download_url);
 const current=exports.data?.items[0];
 const visible=[...(current && current.id!==recent?.id ? [current] : []),...(recent ? [recent] : [])];
 const publish = async () => {
   if (!info.data || busy) return;
   setBusy(true); setMessage(''); onIssues([]);
   try {
     const snapshot = document, target = track, asset = info.data.asset_id;
     const output = (format: 'ttml'|'lrc'|'elrc') => {
       try { return exportLyricFile(snapshot,format,editing); }
       catch (cause) { const issues=cause instanceof DocumentOutputError?cause.issues:[{kind:'line' as const,lineId:'',missing:[],code:'serialization' as const,message:cause instanceof Error?cause.message:t('packaging.serializeFailed')}]; throw new DocumentOutputError(issues.map(issue=>({...issue,formats:[format.toUpperCase()],severity:'error'}))); }
     };
     if (info.data.container === 'mp4') output('ttml');
     if (kind==='none'&&info.data.container!=='mp4') throw new MessageError(describeMessage('packaging.lrcRequired'));
     const lrc=kind==='none'?null:output(kind);
     const saved = await saveForPackaging();
     if (!saved || saved.document !== snapshot || saved.editing && saved.editing !== editing) throw new MessageError(describeMessage('packaging.snapshotChanged'));
     setCaptured(snapshot);
     await publishingApi.publish(projectId,saved.revision,asset,{lrc_kind:kind,lrc_text:lrc,target_track_id:target});
     setMessage(describeMessage('packaging.submitted',{revision:saved.revision})); await client.invalidateQueries({queryKey:['exports',projectId]});
   } catch(e) { if(e instanceof DocumentOutputError)onIssues(uniqueOutputIssues(e.issues));else setMessage(errorMessage(e)); }
   finally { setBusy(false); }
 };
 return <>
 {info.data && <><p>{t('packaging.source')}{info.data.filename} · {info.data.format_label}</p><p className={styles.hint}>{info.data.container === 'mp4' ? t('packaging.mp4Target',{tags:kind==='none'?t('packaging.keepTags'):t('packaging.tagTarget',{kind:kind==='elrc'?t('packaging.extended'):t('packaging.plain')}),track:info.data.tracks.length?track?t('packaging.overwriteTrack',{track}):t('packaging.chooseOverwrite'):t('packaging.addStpp')}) : info.data.container === 'mp3' ? t('packaging.id3') : info.data.container === 'flac' ? t('packaging.flac') : t('packaging.unsupported')} {t('packaging.copyHelp')}</p></>}

 <label>{t('packaging.embedded')}<Select value={kind} onChange={e=>setKind(e.target.value as PackagingLrcKind)}>{info.data?.container==='mp4'&&<option value="none">{t('packaging.none')}</option>}<option value="lrc">{t('packaging.lrc')}</option><option value="elrc">{t('packaging.elrcAngles')}</option></Select></label>
 {info.data?.container === 'mp3' && <p className={styles.hint}>{t('packaging.usltHelp')}</p>}
 {info.data?.tracks.length ? <label>{t('packaging.overwriteStpp')}<Select aria-label={t('packaging.overwriteStpp')} value={track ?? ''} onChange={e=>setTrack(e.target.value ? Number(e.target.value) : null)}><option value="">{t('packaging.chooseTrack')}</option>{info.data.tracks.map(item=><option key={item.track_id} value={item.track_id}>{item.track_id} · {item.language} · {item.name || t('packaging.unnamed')}</option>)}</Select></label> : info.data?.container === 'mp4' ? <p className={styles.hint}>{t('packaging.noStpp')}</p> : null}
 {info.isError && <p role="alert">{t('common.readFailed')}<IconButton icon="refresh" label={t('packaging.retrySource')} data-role="secondary" onClick={()=>void info.refetch()}/></p>}
 {info.data && !info.data.supported && <p role="alert">{info.data.error ?? t('packaging.unsupportedHelp')}</p>}
 <div className={styles.actions}><button data-role="primary" onClick={()=>void publish()} disabled={busy || Boolean(exports.data?.items.some(item=>active.has(item.status))) || !info.data?.supported || Boolean(info.data.tracks.length && !track)}>{busy ? t('packaging.submitting') : t('packaging.submit')}</button>{recent?.download_url && !exports.isError ? <a data-role="secondary" href={recent.download_url}>{t('packaging.download')}</a> : <button data-role="secondary" disabled>{t('packaging.download')}</button>}</div>
 {message && <p role="status">{message}</p>}{captured && captured !== document && <p>{t('packaging.newerEdits')}</p>}
 <h2>{t('packaging.history')}</h2>{exports.isError && <p>{t('packaging.historyFailed')}<IconButton icon="refresh" label={t('packaging.retryHistory')} data-role="secondary" onClick={()=>void exports.refetch()}/></p>}
 {visible.map(item=>{
   const passed=item.status==='succeeded' && item.report?.passed===true;
   const label=item.lrc_kind==='elrc' ? t('packaging.elrc') : t('packaging.lrc');
   const result=active.has(item.status) ? t('packaging.running') : passed && item.report?.subtitle_codec==='stpp' ? t('packaging.wroteStpp',{tags:item.lrc_kind==='none'?t('packaging.keepTagsSuffix'):` · ${label}`}) : passed && item.report?.lyrics_preserved ? t('packaging.wroteLyrics',{format:label}) : item.status==='failed' ? t('packaging.failed') : item.status==='cancelled' ? t('task.cancelled') : item.status==='unavailable' ? t('packaging.unavailable') : item.status==='interrupted' ? t('packaging.interrupted') : item.status;
   return <article key={item.id}><h3>{item.id===recent?.id ? t('packaging.recent') : t('packaging.currentTask')}</h3>{item.id===recent?.id && dirty && <p>{t('packaging.unsaved')}</p>}<p>{item.asset_filename ?? t('packaging.noSourceName')} · {item.format_label ?? t('packaging.unknownFormat')} · {result}{item.track_id ? ' · '+t('packaging.stppTrack',{track:item.track_id}) : ''}</p><p className={styles.hint}>{t('packaging.revision')}{item.revision}{item.stale ? t('packaging.oldRevision') : ''}{item.filename ? ` · ${item.filename}` : ''}</p>
   {active.has(item.status) && <button data-role="secondary" onClick={()=>void jobsApi.cancel(item.id).then(()=>client.invalidateQueries({queryKey:['exports',projectId]})).catch(e=>setMessage(errorMessage(e)))}>{t('task.cancel')}</button>}<Disclosure title={t('packaging.report')}>{() => <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(item.error ?? item.report,null,2)}</pre>}</Disclosure></article>;
 })}
 {!exports.data?.items.length && <p className={styles.hint}>{t('packaging.empty')}</p>}
 </>;
}

const t=i18n.t.bind(i18n);
