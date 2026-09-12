import { useMemo } from "react";
import type { ImportProposal } from "../adapters/http/client";
import type { StudioLyricDocument } from "../domain/document";
import { parseStudioTtml } from "../adapters/ttml";

type Props = {
  proposal: ImportProposal | null;
  currentRevision: string;
  dirty?: boolean;
  document?: StudioLyricDocument;
  onApply: () => void;
};

type CandidateLine = { text: string; beginUs: number | null; endUs: number | null };

export function CandidatePanel({ proposal, currentRevision, dirty = false, document, onApply }: Props) {
  const candidateLines = useMemo<CandidateLine[]>(() => {
    if (!proposal) return [];
    if (proposal.candidate.ttml) {
      try {
        return parseStudioTtml(proposal.candidate.ttml).lines.map((line) => ({ text: line.text, beginUs: line.beginUs, endUs: line.endUs }));
      } catch {
        return [];
      }
    }
    return (proposal.candidate.lines ?? []).map((line) => ({ text: line.text, beginUs: line.begin_us ?? null, endUs: line.end_us ?? null }));
  }, [proposal]);
  if (!proposal) return <section aria-label="候选"><strong>暂无候选</strong><p>导入 TTML、LRC 或文本后在此比较差异。</p></section>;
  const stale = dirty || proposal.input_revision !== currentRevision || candidateLines.length === 0;
  return <section aria-label="候选"><strong>候选差异 · {proposal.candidate.format}</strong>{dirty && <p role="alert">请先保存当前编辑。</p>}{proposal.input_revision !== currentRevision && <p role="alert">候选来自旧 revision。</p>}<ol>{candidateLines.map((candidate, index) => { const current = document?.lines[index]; const same = current && current.text === candidate.text && current.beginUs === candidate.beginUs && current.endUs === candidate.endUs; return <li key={`${candidate.text}-${index}`}><span>{current?.text ?? "（新增）"} → {candidate.text}</span><small>{same ? "无变化" : `${formatTime(current?.beginUs ?? null)}–${formatTime(current?.endUs ?? null)} → ${formatTime(candidate.beginUs)}–${formatTime(candidate.endUs)}`}</small></li>; })}</ol><button disabled={stale} onClick={onApply}>人工应用</button></section>;
}

function formatTime(value: number | null) { return value == null ? "未知" : `${(value / 1e6).toFixed(3)}s`; }
