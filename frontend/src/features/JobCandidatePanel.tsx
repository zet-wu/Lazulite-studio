import { Select } from '../shared/Select';
import { useState } from 'react';
import type { JobResult } from '../adapters/http/jobs';
import { createLine, createLyricDocument, type LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';

function candidateDocument(lines: Array<{ text?: string; id?: string; begin_ms?: number | null; end_ms?: number | null }>): LyricDocument {
  if (!lines.length) throw new Error('候选没有歌词行');
  const document = createLyricDocument();
  document.lines = lines.map((item, index) => {
    const line = createLine(item.text ?? '', item.id || `proposal-${index + 1}`);
    line.beginMs = item.begin_ms ?? null;
    line.endMs = item.end_ms ?? null;
    if (line.words.length) { line.words[0].beginMs = line.beginMs; line.words[0].endMs = line.endMs; }
    return line;
  });
  return document;
}

export function JobCandidatePanel({ result, currentRevision, currentAssetId, dirty, document, onApply }: {
  result: JobResult | null; currentRevision: string; currentAssetId: string | null; dirty: boolean; document: LyricDocument; onApply: (command: LyricCommand) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('');
  if (!result) return <section aria-label="任务候选">请选择已完成任务查看候选。</section>;
  const stale = dirty || result.binding?.revision !== currentRevision || result.binding?.asset_id !== currentAssetId;
  const apply = () => {
    if (stale) return;
    try {
      if (result.kind === 'search') return;
      if (result.kind === 'fetch') {
        const lines = result.items[selected]?.lines;
        if (!lines?.length) throw new Error('取词候选没有歌词行');
        onApply({ type: 'replace-document', document: candidateDocument(lines) });
      } else if (result.kind === 'transcribe') {
        onApply({ type: 'replace-document', document: candidateDocument(result.segments) });
      } else if (result.kind === 'line_align') {
        const commands: LyricCommand[] = result.lines.filter((item) => document.lines.some((line) => line.id === item.line_id)).map((item) => ({ type: 'set-line-time', lineId: item.line_id, beginMs: item.begin_ms ?? null, endMs: item.end_ms ?? null }));
        if (!commands.length) throw new Error('没有可应用的行时间');
        onApply({ type: 'batch', commands: commands as Extract<LyricCommand, { type: 'set-line-time' }>[] });
      }
      setMessage('候选已应用');
    } catch (error) { setMessage(error instanceof Error ? error.message : '应用候选失败'); }
  };
  return <section aria-label="任务候选"><h2>任务候选 · {result.kind}</h2>
    {stale && <p role="alert">结果绑定的 revision/asset 已过期，或有未保存编辑。</p>}
    {result.kind === 'search' && result.items.map((item, index) => <p key={index}>{item.title ?? '未知标题'} · {item.artist ?? '未知艺人'}</p>)}
    {result.kind === 'fetch' && <><Select aria-label="取词版本" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{result.items.map((item, index) => <option key={index} value={index}>{item.candidate?.title ?? `版本 ${index + 1}`}</option>)}</Select><ol>{result.items[selected]?.lines?.map((line, index) => <li key={index}>{line.text}</li>)}</ol></>}
    {result.kind === 'transcribe' && <ol>{result.segments.map((item, index) => <li key={index}>{item.text}</li>)}</ol>}
    {result.kind === 'line_align' && <ol>{result.lines.map((item) => <li key={item.line_id}>{item.line_id}: {item.begin_ms == null ? '未定' : `${item.begin_ms / 1e3}s`}–{item.end_ms == null ? '未定' : `${item.end_ms / 1e3}s`}</li>)}</ol>}
    {!['search', 'reading', 'forced_align'].includes(result.kind) && <button data-role="secondary" disabled={stale} onClick={apply}>人工应用候选</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
