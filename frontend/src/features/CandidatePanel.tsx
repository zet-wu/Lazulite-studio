import { useMemo } from 'react';
import type { ImportLine, ImportProposal } from '../adapters/http/client';
import { parseLyricTtml } from '../adapters/ttml/lyric-codec';
import { createLine, createLyricDocument, lineText, type LyricDocument } from '../domain/lyric-document';

export function proposalDocument(proposal: ImportProposal): LyricDocument {
  if (proposal.candidate.ttml) return parseLyricTtml(proposal.candidate.ttml);
  const source: ImportLine[] = proposal.candidate.lines ?? proposal.candidate.text?.split(/\r?\n/).map((text) => ({ text })) ?? [];
  if (!source.length) throw new Error('导入候选没有歌词行');
  const document = createLyricDocument();
  document.lines = source.map((item) => {
    const line = createLine(item.text, item.id || `line-${crypto.randomUUID()}`);
    line.beginUs = item.begin_us ?? null;
    line.endUs = item.end_us ?? null;
    if (line.words.length) { line.words[0].beginUs = line.beginUs; line.words[0].endUs = line.endUs; }
    return line;
  });
  return document;
}

export function CandidatePanel({ proposal, currentRevision, dirty, document, onApply }: { proposal: ImportProposal | null; currentRevision: string; dirty: boolean; document: LyricDocument; onApply: (document: LyricDocument) => void }) {
  const parsed = useMemo(() => {
    if (!proposal) return null;
    try { return { document: proposalDocument(proposal), error: null }; }
    catch (error) { return { document: null, error: error instanceof Error ? error.message : '导入候选无法解析' }; }
  }, [proposal]);
  if (!proposal) return <section aria-label="候选"><strong>暂无导入候选</strong></section>;
  const stale = dirty || proposal.input_revision !== currentRevision;
  return <section aria-label="候选"><h2>导入候选 · {proposal.candidate.format}</h2>
    {stale && <p role="alert">候选已过期，或有未保存编辑。</p>}
    {parsed?.error && <p role="alert">{parsed.error}</p>}
    {proposal.diagnostics.map((item, index) => <p key={index}>{item.message ?? item.code}</p>)}
    <ol>{parsed?.document?.lines.map((line, index) => <li key={line.id}>{lineText(document.lines[index] ?? createLine(''))} → {lineText(line)}</li>)}</ol>
    <button disabled={stale || !parsed?.document} onClick={() => { if (parsed?.document) onApply(parsed.document); }}>人工应用</button>
  </section>;
}
