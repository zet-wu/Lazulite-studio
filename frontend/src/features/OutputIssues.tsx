import { Disclosure as Branch } from '../shared/Disclosure';
import { Icon } from '../shared/Icon';
import { useEffect, useRef, useState } from 'react';
import { outputIssueKey, type OutputIssue } from '../adapters/output-validation';
import { lineText, type LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
const reasons: Record<NonNullable<OutputIssue['code']>, string> = {
  'invalid-agent-type': '歌手类型', 'missing-time': '缺少时间', 'invalid-range': '时间范围',
  'unsupported-order': '时间顺序', 'empty-content': '空内容', 'punctuation-zero': '标点零时长', 'serialization': '序列化',
};
export { Disclosure as Branch } from '../shared/Disclosure';
type IssueSelection = { ids: string[]; toggle: (id: string) => void };
function IssueItems({ issues, keys, locate, selection }: { issues: OutputIssue[]; keys: Set<string>; locate: (issue: OutputIssue) => void; selection?: IssueSelection }) {
  const [limit, setLimit] = useState(50);
  return <><ul>{issues.slice(0, limit).map(issue => {
    const blocking = keys.has(outputIssueKey(issue));
    return <li key={`${outputIssueKey(issue)}:${issue.severity ?? ''}`} data-blocking={blocking}>
      {selection && <input type="checkbox" aria-label={`选择 ${issue.message}`} checked={selection.ids.includes(issue.wordId ?? issue.agentId ?? issue.lineId)} onChange={()=>selection.toggle(issue.wordId ?? issue.agentId ?? issue.lineId)}/>}
      {!issue.lineId && !issue.agentId ? <span>{issue.message}</span> : <button data-role="inline" aria-label={issue.message} aria-description={blocking ? '本次操作受阻，需要处理' : undefined} onClick={() => locate(issue)}>{blocking && <Icon name="warning" />}{selection && issue.wordId ? <strong className="studio-lyric-quote" title={issue.message}>{issue.message}</strong> : issue.message}</button>}
      {issue.severity && <small> {issue.severity === 'error' ? '阻塞' : '核对提示'} · {issue.formats?.join('、')}</small>}
    </li>;
  })}</ul>{issues.length > limit && <button data-role="secondary" onClick={() => setLimit(value => value + 50)}>再显示 50 项（剩余 {issues.length - limit} 项）</button>}</>;
}
export function LineGroups({ issues, keys, locate, document, selection }: { issues: OutputIssue[]; keys: Set<string>; locate: (issue: OutputIssue) => void; document?: LyricDocument; selection?: IssueSelection }) {
  const [limit, setLimit] = useState(50);
  const groups = new Map<string, OutputIssue[]>();
  for (const issue of issues) {
    const key = issue.agentId ? `agent:${issue.agentId}` : issue.lineId || 'serialization';
    const group = groups.get(key) ?? []; group.push(issue); groups.set(key, group);
  }
  return <>{[...groups].slice(0, limit).map(([key, group]) => {
    const issue = group[0], line = document?.lines.find(line => line.id === issue.lineId);
    const label = issue.agentId ? `歌手 ${issue.agentId}` : line ? `第 ${document!.lines.filter(item => !item.backgroundOf).findIndex(item => item.id === (line.backgroundOf ?? line.id)) + 1} 行${line.backgroundOf ? ' · 背景' : ''}` : issue.lineId ? issue.message.split('：')[0].replace(/第 \d+ (词|读音单元).*$/, '') : '无法定位的序列化问题';
    return <Branch key={key} title={<>{label} · {group.length} 项{line && <strong className="studio-lyric-quote" title={lineText(line)}> {lineText(line).slice(0, 40)}{lineText(line).length > 40 ? '…' : ''}</strong>}</>} initiallyOpen={group.some(item => keys.has(outputIssueKey(item)))}>{() => <IssueItems issues={group} keys={keys} locate={locate} selection={selection} />}</Branch>;
  })}{groups.size > limit && <button data-role="secondary" onClick={() => setLimit(value => value + 50)}>再显示 50 组（剩余 {groups.size - limit} 组）</button>}</>;
}
export function OutputIssues({ issues, locate, highlighted = [], document }: { issues: OutputIssue[]; locate: (issue: OutputIssue) => void; highlighted?: OutputIssue[]; document?: LyricDocument }) {
  const root = useRef<HTMLDivElement>(null);
  const keys = new Set(highlighted.map(outputIssueKey));
  const signature = JSON.stringify([...keys]);
  useEffect(() => { root.current?.querySelector('[data-blocking="true"]')?.scrollIntoView({ block: 'nearest' }); }, [signature]);
  if (!issues.length) return null;
  const groups = new Map<string, OutputIssue[]>();
  for (const issue of issues) { const key = issue.code ?? 'missing-time'; const group = groups.get(key) ?? []; group.push(issue); groups.set(key, group); }
  return <div ref={root} className={styles.outputIssues} role={keys.size ? 'alert' : 'status'}><p>{keys.size ? `本次操作有 ${keys.size} 项需要处理` : `有 ${issues.length} 项需要处理：`}</p>
    {[...groups].map(([code, group]) => <Branch key={`${code}:${signature}`} title={`${reasons[code as keyof typeof reasons]} · ${group.length} 项，涉及 ${new Set(group.map(issue => issue.lineId).filter(Boolean)).size} 行`} initiallyOpen={group.some(issue => keys.has(outputIssueKey(issue)))}>{() => <LineGroups issues={group} keys={keys} locate={locate} document={document} />}</Branch>)}
  </div>;
}
