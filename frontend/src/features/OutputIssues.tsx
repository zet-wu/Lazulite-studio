import { useEffect, useRef } from 'react';
import { outputIssueKey, type OutputIssue } from '../adapters/output-validation';
import styles from './acquisition.module.css';
export function OutputIssues({ issues, locate, highlighted = [] }: { issues: OutputIssue[]; locate: (issue: OutputIssue)=>void; highlighted?: OutputIssue[] }) {
 const root = useRef<HTMLDivElement>(null);
 const keys = new Set(highlighted.map(outputIssueKey));
 const signature = JSON.stringify([...keys]);
 useEffect(()=>{ root.current?.querySelector('[data-blocking="true"]')?.scrollIntoView({block:'nearest'}); },[signature]);
 if (!issues.length) return null;
 return <div ref={root} className={styles.outputIssues} role={keys.size ? "alert" : "status"}><p>{keys.size ? `本次操作有 ${keys.size} 项需要处理` : `有 ${issues.length} 项需要处理：`}</p><ul>{issues.map(issue=>{
  const key=`${outputIssueKey(issue)}:${issue.severity ?? ''}`, blocking=keys.has(outputIssueKey(issue));
  return <li key={key} data-blocking={blocking}><button data-role="secondary" disabled={!issue.lineId && !issue.agentId} aria-label={issue.message} aria-description={blocking ? "本次操作受阻，需要处理" : undefined} onClick={()=>locate(issue)}>{blocking && <span aria-hidden="true">⚠ </span>}{issue.message}</button>{issue.severity && <small> {issue.severity === 'error' ? '阻塞' : '核对提示'} · {issue.formats?.join('、')}</small>}</li>;
 })}</ul></div>;
}
