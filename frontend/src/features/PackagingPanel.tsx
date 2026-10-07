import { Icon } from '../shared/Icon';
import { useProjectEditing } from './editor/ProjectEditingContext';
import type { ProjectEditing } from '../domain/project-editing';
import { describeLyricFormat } from '../adapters/format-description';
import { validateLyrics } from '../adapters/lyric-validation';
import { Select } from '../shared/Select';
import { usePreference } from './editor/use-preference';
import { OutputIssues } from './OutputIssues';
import { collectOutputIssues, uniqueOutputIssues, DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { MusicPackaging } from './MusicPackaging';
import { useEffect, useState } from 'react';
import type { LyricFormat } from '../adapters/lyric-formats';
import type { LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
export function PackagingPanel(props: { title?: string; document: LyricDocument; dirty?: boolean; onExportFormat?: (format: LyricFormat) => void; saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined>; projectId?: string; sourceAssetId?: string; locateIssue: (issue: OutputIssue) => void; externalIssues?: OutputIssue[] }) {
 const editing = useProjectEditing();
 const [validation, setValidation] = useState<{ document: LyricDocument; projectId?: string; issues: OutputIssue[] } | null>(null);
 const [blocking,setBlocking] = useState<OutputIssue[]>([]), [message,setMessage] = useState('');
 const [format, setFormat] = usePreference<LyricFormat>(`studio:download:${props.projectId ? `project:${props.projectId}` : `local:${props.title}`}`, 'ttml', (v): v is LyricFormat => typeof v === 'string' && ['ttml','txt','lrc','elrc','eslrc','qrc','yrc','lys','ass'].includes(v));
 useEffect(()=>{setBlocking([]);setMessage('');},[editing,props.document,props.projectId,format]);
 useEffect(() => { setValidation(null); }, [editing,props.document, props.projectId]);
 const current = validation?.document === props.document && validation.projectId === props.projectId;
 const issues = current ? validation.issues : [];
 return <div className={styles.page}><section className={styles.pane}><button data-role="primary" onClick={() => setValidation({ document: props.document, projectId: props.projectId, issues: validateLyrics(props.document,editing) })}>歌词校验</button>
 <OutputIssues issues={issues} locate={props.locateIssue} />{!current ? <p>{validation ? '文档已变化，请重新执行歌词校验。' : '尚未执行歌词校验。'}</p> : !issues.length && <p>当前检查未发现问题</p>}
 <OutputIssues issues={blocking} highlighted={blocking} locate={props.locateIssue} />
 </section><section className={styles.pane}><h2>歌词下载</h2><div className={styles.downloadRow}>
 <label>导出格式 <Select aria-label="导出格式" value={format} onChange={e => setFormat(e.target.value as LyricFormat)}>{[['ttml','TTML'],['txt','纯文本'],['lrc','普通 LRC'],['elrc','扩展 LRC（尖括号）'],['eslrc','ESLRC（正文后方括号）'],['qrc','QRC'],['yrc','YRC'],['lys','LYS'],['ass','ASS']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select></label><button data-role="secondary" onClick={() => {
 setBlocking([]); setMessage('');
 try { const problems=collectOutputIssues(props.document,format,editing); if(problems.length)throw new DocumentOutputError(problems); props.onExportFormat?.(format); }
 catch(e) { if(e instanceof DocumentOutputError)setBlocking(uniqueOutputIssues(e.issues)); else setMessage(e instanceof Error ? e.message : '导出失败'); }
 }}>下载歌词</button></div><details><summary>导出对照</summary><table className={styles.formatComparison} aria-label="所选格式导出对照"><thead><tr><th scope="col">要素</th><th scope="col">导出结果</th></tr></thead><tbody>{describeLyricFormat(props.document, format as Exclude<LyricFormat,'krc'>).map((row,index) => <tr key={row.element}><th scope="row">{row.element}</th><td><span className={styles.formatDetail} tabIndex={0} aria-describedby={`format-detail-${index}`}>{row.status === 'partial' ? <span>{row.result}</span> : <span role="img" aria-label={row.result}><Icon name={row.status === 'preserved' ? 'check' : 'close'}/></span>}<span role="tooltip" id={`format-detail-${index}`}>{row.detail}</span></span></td></tr>)}</tbody></table></details>{message && <p role="alert">{message}</p>}
 <h2>音乐文件</h2>{props.projectId && props.sourceAssetId && props.saveForPackaging ? <MusicPackaging dirty={props.dirty} key={props.projectId} onIssues={setBlocking} projectId={props.projectId} document={props.document} saveForPackaging={props.saveForPackaging} /> : <p>上传音乐后可打包音乐文件；单独下载歌词无需音乐。</p>}</section></div>;
}
