import { i18n } from '../i18n';
import {useTranslation} from 'react-i18next';
import {issueLocation,issueText} from './output-messages';
import { Disclosure } from '../shared/Disclosure';
import { Icon } from '../shared/Icon';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { outputIssueKey, type OutputIssue } from '../adapters/output-validation';
import { lineText, type LyricDocument } from '../domain/lyric-document';
import styles from './acquisition.module.css';
const reasons: Record<NonNullable<OutputIssue['code']>, string> = {
  'output-configuration': 'validation.outputConfiguration',
  'audio-range': 'validation.audioRange', 'invalid-agent-type': 'validation.agentType', 'missing-time': 'validation.missingTime', 'invalid-range': 'validation.range',
  'unsupported-order': 'validation.order', 'empty-content': 'validation.empty', 'punctuation-zero': 'validation.punctuation', 'serialization': 'validation.serialization',
};
export function Branch(props: ComponentProps<typeof Disclosure>) {
  useTranslation();
  return <Disclosure {...props} className={styles.validationBranch} />;
}
type IssueSelection = { ids: string[]; toggle: (id: string) => void };
function IssueItems({ issues, keys, locate, selection, document }: { issues: OutputIssue[]; keys: Set<string>; locate: (issue: OutputIssue) => void; selection?: IssueSelection; document?: LyricDocument }) {
  useTranslation();
  const [limit, setLimit] = useState(50);
  return <><ul>{issues.slice(0, limit).map(issue => {
    const blocking = keys.has(outputIssueKey(issue));
    const text=issueText(issue,document);
    return <li key={`${outputIssueKey(issue)}:${issue.severity ?? ''}:${issue.outputIds?.join(',') ?? ''}`} data-blocking={blocking}>
      {selection && <input type="checkbox" aria-label={t('validation.selectIssue',{message:text})} checked={selection.ids.includes(issue.wordId ?? issue.agentId ?? issue.lineId)} onChange={()=>selection.toggle(issue.wordId ?? issue.agentId ?? issue.lineId)}/>}
      {!issue.lineId && !issue.agentId && !issue.karaokeSettings && !issue.segmentId ? <span>{text}</span> : <button data-role="inline" aria-label={text} aria-description={blocking ? t('validation.blockingHelp') : undefined} onClick={() => locate(issue)}>{blocking && <Icon name="warning" />}{selection && issue.wordId ? <strong className="studio-lyric-quote" title={text}>{text}</strong> : text}</button>}
      {issue.severity && <small> {issue.severity === 'error' ? t('validation.blocking') : t('validation.review')} · {issue.formats?.map(format=>format==='audio-range'?t('validation.audioRange'):format==='timing-review'?t('validation.review'):format).join(' / ')}</small>}
    </li>;
  })}</ul>{issues.length > limit && <button data-role="secondary" onClick={() => setLimit(value => value + 50)}>{t('validation.moreItems',{count:issues.length-limit})}</button>}</>;
}
export function LineGroups({ issues, keys, locate, document, selection }: { issues: OutputIssue[]; keys: Set<string>; locate: (issue: OutputIssue) => void; document?: LyricDocument; selection?: IssueSelection }) {
  useTranslation();
  const [limit, setLimit] = useState(50);
  const groups = new Map<string, OutputIssue[]>();
  for (const issue of issues) {
    const key = issue.agentId ? `agent:${issue.agentId}` : issue.lineId || (issue.segmentId ? 'acoustics' : issue.karaokeSettings ? 'karaoke-settings' : issue.code === 'serialization' ? 'serialization' : 'project');
    const group = groups.get(key) ?? []; group.push(issue); groups.set(key, group);
  }
  return <>{[...groups].slice(0, limit).map(([key, group]) => {
    const issue = group[0], line = document?.lines.find(line => line.id === issue.lineId);
    const label=issueLocation({...issue,wordId:undefined,rubyId:undefined,unitId:undefined,trackId:undefined},document);
    return <Branch key={key} title={<>{label} · {t('editor.itemCount',{count:group.length})}{line && <strong className="studio-lyric-quote" title={lineText(line)}> {lineText(line).slice(0, 40)}{lineText(line).length > 40 ? '…' : ''}</strong>}</>} initiallyOpen={group.some(item => keys.has(outputIssueKey(item)))}>{() => <IssueItems issues={group} keys={keys} locate={locate} selection={selection} document={document} />}</Branch>;
  })}{groups.size > limit && <button data-role="secondary" onClick={() => setLimit(value => value + 50)}>{t('validation.moreGroups',{count:groups.size-limit})}</button>}</>;
}
export function OutputIssues({ issues, locate, highlighted = [], document }: { issues: OutputIssue[]; locate: (issue: OutputIssue) => void; highlighted?: OutputIssue[]; document?: LyricDocument }) {
  useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const keys = new Set(highlighted.map(outputIssueKey));
  const signature = JSON.stringify([...keys]);
  useEffect(() => { root.current?.querySelector('[data-blocking="true"]')?.scrollIntoView({ block: 'nearest' }); }, [signature]);
  if (!issues.length) return null;
  const groups = new Map<string, OutputIssue[]>();
  for (const issue of issues) { const key = issue.code ?? 'missing-time'; const group = groups.get(key) ?? []; group.push(issue); groups.set(key, group); }
  return <div ref={root} className={styles.outputIssues} role={keys.size ? 'alert' : 'status'}><p>{keys.size ? t('validation.operationCount',{count:keys.size}) : t('validation.issueCount',{count:issues.length})}</p>
    {[...groups].map(([code, group]) => <Branch key={`${code}:${signature}`} title={t('validation.groupSummary',{reason:t(reasons[code as keyof typeof reasons]),count:group.length,lines:new Set(group.map(issue=>issue.lineId).filter(Boolean)).size})} initiallyOpen={group.some(issue => keys.has(outputIssueKey(issue)))}>{() => <LineGroups issues={group} keys={keys} locate={locate} document={document} />}</Branch>)}
  </div>;
}

const t=i18n.t.bind(i18n);
