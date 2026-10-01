import type { OutputIssue } from '../adapters/output-validation';
import styles from './acquisition.module.css';
export function OutputIssues({ issues, locate }: { issues: OutputIssue[]; locate: (issue: OutputIssue)=>void }) {
 if (!issues.length) return null;
 return <div className={styles.outputIssues} role="alert"><p>有 {issues.length} 项需要处理：</p><ul>{issues.map((issue,i)=><li key={i}><button onClick={()=>locate(issue)}>{issue.message}</button></li>)}</ul></div>;
}
