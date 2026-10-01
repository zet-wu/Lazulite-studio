import { OutputIssues } from './OutputIssues';
import { DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { MusicPackaging } from './MusicPackaging';
import { useState } from 'react';
import type { LyricFormat } from '../adapters/lyric-formats';
import { renderLrc } from '../adapters/lrc';
import type { LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
export function PackagingPanel(props: { document: LyricDocument; onExportFormat?: (format: LyricFormat) => void; saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument } | undefined>; projectId?: string; locateIssue: (issue: OutputIssue) => void; externalIssues?: OutputIssue[] }) {
 const [issues,setIssues] = useState<OutputIssue[]>([]), [message,setMessage] = useState('');
 const [format, setFormat] = useState<LyricFormat>('ttml');
 let overlap: number[] = [];
 try { overlap = renderLrc(props.document).overlapLines; } catch { /* Export action reports missing timing. */ }
 return <div className={styles.page}><section className={styles.pane}><h2>歌词下载</h2><p className={styles.hint}>TTML 输出纯歌词格式；兼容格式按各自能力输出。</p>
 <label>导出格式 <select aria-label="导出格式" value={format} onChange={e => setFormat(e.target.value as LyricFormat)}>{[['ttml','TTML'],['txt','纯文本'],['lrc','普通 LRC'],['elrc','扩展 LRC（尖括号）'],['eslrc','ESLRC（正文后方括号）'],['qrc','QRC'],['yrc','YRC'],['lys','LYS'],['ass','ASS']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><button onClick={() => { setIssues([]); setMessage(''); try { props.onExportFormat?.(format); } catch(e) { if(e instanceof DocumentOutputError)setIssues(e.issues); else setMessage(e instanceof Error ? e.message : '导出失败'); } }}>下载歌词</button>
 <OutputIssues issues={issues.length ? issues : props.externalIssues ?? []} locate={props.locateIssue} />{message && <p role="alert">{message}</p>}
 {overlap.length > 0 && <details><summary>包含重叠主行，LRC 播放器可能无法同时显示全部声部</summary><p>涉及行：{overlap.join('、')}。TTML 保留并行结构。</p></details>}
 </section><section className={styles.pane}><h2>音乐文件</h2>{props.projectId && props.saveForPackaging ? <MusicPackaging locateIssue={props.locateIssue} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging} /> : <p>音乐打包需要关联项目音频，请从项目列表打开带音频的项目。</p>}</section></div>;
}
