import { validateLyrics } from '../adapters/lyric-validation';
import { Select } from '../shared/Select';
import { usePreference } from './editor/use-preference';
import { OutputIssues } from './OutputIssues';
import { collectOutputIssues, uniqueOutputIssues, DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { MusicPackaging } from './MusicPackaging';
import { useEffect, useState } from 'react';
import type { LyricFormat } from '../adapters/lyric-formats';
import { renderLrc } from '../adapters/lrc';
import type { LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
export function PackagingPanel(props: { title?: string; document: LyricDocument; dirty?: boolean; onExportFormat?: (format: LyricFormat) => void; saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument } | undefined>; projectId?: string; locateIssue: (issue: OutputIssue) => void; externalIssues?: OutputIssue[] }) {
 const [validation, setValidation] = useState<{ document: LyricDocument; projectId?: string; issues: OutputIssue[] } | null>(null);
 const [blocking,setBlocking] = useState<OutputIssue[]>([]), [message,setMessage] = useState('');
 const [format, setFormat] = usePreference<LyricFormat>(`studio:download:${props.projectId ? `project:${props.projectId}` : `local:${props.title}`}`, 'ttml', (v): v is LyricFormat => typeof v === 'string' && ['ttml','txt','lrc','elrc','eslrc','qrc','yrc','lys','ass'].includes(v));
 useEffect(()=>{setBlocking([]);setMessage('');},[props.document,props.projectId,format]);
 useEffect(() => { setValidation(null); }, [props.document, props.projectId]);
 const current = validation?.document === props.document && validation.projectId === props.projectId;
 const issues = current ? validation.issues : [];
 let overlap: number[] = [];
 try { overlap = renderLrc(props.document).overlapLines; } catch { /* The operation reports missing timing. */ }
 return <div className={styles.page}><section className={styles.pane}><button data-role="secondary" onClick={() => setValidation({ document: props.document, projectId: props.projectId, issues: validateLyrics(props.document) })}>歌词校验</button>
 <OutputIssues issues={issues} locate={props.locateIssue} />{!current ? <p>{validation ? '文档已变化，请重新执行歌词校验。' : '尚未执行歌词校验。'}</p> : <p>已检查 TTML、TXT、LRC、扩展 LRC、ESLRC、QRC、YRC、LYS、ASS 及发布歌词约束。{!issues.length && '当前检查未发现问题。'}</p>}
 <OutputIssues issues={blocking} highlighted={blocking} locate={props.locateIssue} />
 </section><section className={styles.pane}><h2>歌词下载</h2><div className={styles.downloadRow}>
 <label>导出格式 <Select aria-label="导出格式" value={format} onChange={e => setFormat(e.target.value as LyricFormat)}>{[['ttml','TTML'],['txt','纯文本'],['lrc','普通 LRC'],['elrc','扩展 LRC（尖括号）'],['eslrc','ESLRC（正文后方括号）'],['qrc','QRC'],['yrc','YRC'],['lys','LYS'],['ass','ASS']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select></label><button data-role="secondary" onClick={() => {
 setBlocking([]); setMessage('');
 try { const problems=collectOutputIssues(props.document,format); if(problems.length)throw new DocumentOutputError(problems); props.onExportFormat?.(format); }
 catch(e) { if(e instanceof DocumentOutputError)setBlocking(uniqueOutputIssues(e.issues)); else setMessage(e instanceof Error ? e.message : '导出失败'); }
 }}>下载歌词</button></div>{message && <p role="alert">{message}</p>}
 {overlap.length > 0 && <details><summary>包含重叠主行，LRC 播放器可能无法同时显示全部声部</summary><p>涉及行：{overlap.join('、')}。TTML 保留并行结构。</p></details>}
 <h2>音乐文件</h2>{props.projectId && props.saveForPackaging ? <MusicPackaging dirty={props.dirty} key={props.projectId} onIssues={setBlocking} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging} /> : <p>音乐打包需要关联项目音频，请从项目列表打开带音频的项目。</p>}</section></div>;
}
