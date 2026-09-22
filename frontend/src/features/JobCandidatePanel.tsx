import { useEffect, useMemo, useState } from "react";
import type { StudioLyricDocument } from "../domain/document";
import type { EditCommand } from "../domain/editing";
import type {
  AlignResult,
  ForcedAlignResult,
  FetchResult,
  JobResult,
  ReadingProposal,
  ReadingResult,
  SearchResult,
  TranscribeResult,
} from "../adapters/http/jobs";
import { buildProposalTtml } from "../adapters/ttml/proposal";
import styles from "./job-panel.module.css";

type Props = {
  result: JobResult | null;
  currentRevision: string;
  currentAssetId: string | null;
  dirty: boolean;
  document: StudioLyricDocument;
  onApply: (command: EditCommand) => void;
};
export function JobCandidatePanel({
  result,
  currentRevision,
  currentAssetId,
  dirty,
  document,
  onApply,
}: Props) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [result]);
  if (!result)
    return (
      <section className={styles.panel}>
        <span className={styles.hint}>选择一个已完成任务查看候选。</span>
      </section>
    );
  const stale =
    dirty ||
    result.binding?.revision !== currentRevision ||
    result.binding?.asset_id !== currentAssetId;
  const apply = () => {
    if (stale) return;
    try {
      if (result.kind === "search") return;
      if (result.kind === "fetch") {
        const candidate = result.items[selected];
        if (!candidate?.lines?.length) return;
        onApply({
          type: "replace-document",
          document: buildProposalTtml(candidate.lines),
        });
        return;
      }
      if (result.kind === "transcribe") {
        if (!result.segments.length) return;
        onApply({
          type: "replace-document",
          document: buildProposalTtml(result.segments),
        });
        return;
      }
      if (result.kind === "reading") return;
      if (result.kind === "forced_align") {
        const line = document.lines.find(
          (item) =>
            item.id === result.units[0]?.line_id ||
            item.xmlId === result.units[0]?.line_id,
        );
        const usable = result.units.filter(
          (unit) =>
            unit.granularity === "word" ||
            unit.granularity === "mora" ||
            unit.granularity === "phoneme",
        );
        if (!line || !usable.length) return;
        const request = result.evidence?.request;
        const rubyId =
          request?.coordinate_space === "ruby"
            ? (request.ruby_id ?? null)
            : null;
        const preserved = line.timingUnits.filter((unit) =>
          rubyId ? unit.rubyId !== rubyId : unit.rubyId !== null,
        );
        const scope = rubyId ?? "text";
        onApply({
          type: "update-timing-units",
          lineId: line.id,
          units: [
            ...preserved,
            ...usable.map((unit, index) => ({
              id: `${line.id}-forced-${scope}-${index}`,
              kind: unit.granularity as "word" | "mora" | "phoneme",
              textStart: (unit.source_range ??
                request?.source_range ??
                unit.input_range)[0],
              textEnd: (unit.source_range ??
                request?.source_range ??
                unit.input_range)[1],
              readingStart:
                request?.coordinate_space === "ruby"
                  ? unit.input_range[0]
                  : null,
              readingEnd:
                request?.coordinate_space === "ruby"
                  ? unit.input_range[1]
                  : null,
              rubyId,
              beginUs: unit.start_us,
              endUs: unit.end_us,
            })),
          ],
        });
        return;
      }
      const updates = result.lines.flatMap((item) => {
        const line = document.lines.find(
          (candidate) =>
            candidate.id === item.line_id || candidate.xmlId === item.line_id,
        );
        if (!line || !line.editable.timing) return [];
        return [
          {
            lineId: line.id,
            changes: {
              beginUs: item.begin_us ?? null,
              endUs: item.end_us ?? null,
            },
          },
        ];
      });
      if (updates.length) onApply({ type: "update-lines", updates });
    } catch {
      /* parent displays command errors */
    }
  };
  return (
    <section className={styles.panel} aria-label="任务候选">
      <strong>
        {result.kind === "search"
          ? "搜索候选"
          : result.kind === "fetch"
            ? "取词版本"
            : result.kind === "transcribe"
              ? "转写候选"
              : result.kind === "reading"
                ? "读音候选"
                : result.kind === "forced_align"
                  ? "实验音频对齐候选"
                  : "行对齐候选"}
      </strong>
      {stale && (
        <p className={styles.error}>
          结果绑定的 revision/asset 已过期，或当前有未保存修改。
        </p>
      )}
      {result.kind === "search" ? (
        <SearchView result={result} />
      ) : result.kind === "fetch" ? (
        <FetchView
          result={result}
          selected={selected}
          onSelect={setSelected}
          document={document}
        />
      ) : result.kind === "transcribe" ? (
        <TranscribeView result={result} document={document} />
      ) : result.kind === "reading" ? (
        <ReadingView
          result={result}
          document={document}
          stale={stale}
          onApply={onApply}
        />
      ) : result.kind === "forced_align" ? (
        <ForcedView result={result} />
      ) : (
        <AlignView result={result} document={document} />
      )}
      {result.kind !== "reading" && (
        <button
          className={styles.cancel}
          disabled={
            stale ||
            result.kind === "search" ||
            (result.kind === "forced_align" &&
              !result.units.some((unit) =>
                ["word", "mora", "phoneme"].includes(unit.granularity),
              ))
          }
          onClick={apply}
        >
          人工应用候选
        </button>
      )}
    </section>
  );
}

function ForcedView({ result }: { result: ForcedAlignResult }) {
  return (
    <div className={styles.job}>
      <span className={styles.hint}>
        实验结果 · {result.timing_source ?? "forced alignment"}
      </span>
      {result.units.map((unit, index) => (
        <div className={styles.candidateRow} key={`${unit.line_id}-${index}`}>
          <span>{unit.text || "片段"}</span>
          <span className={styles.hint}>
            {unit.granularity} ·{" "}
            {unit.start_us == null
              ? "未定"
              : `${(unit.start_us / 1e6).toFixed(3)}s`}
            –
            {unit.end_us == null
              ? "未定"
              : `${(unit.end_us / 1e6).toFixed(3)}s`}{" "}
            ·{" "}
            {unit.confidence == null
              ? "置信度未提供"
              : `置信度 ${unit.confidence.toFixed(2)}`}
          </span>
          {unit.granularity === "character" ? (
            <span className={styles.error}>字符粒度仅展示，不能应用</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ReadingView({
  result,
  document,
  stale,
  onApply,
}: {
  result: ReadingResult;
  document: StudioLyricDocument;
  stale: boolean;
  onApply: (command: EditCommand) => void;
}) {
  const grouped = new Map<string, ReadingProposal[]>();
  for (const proposal of result.proposals) {
    const current = grouped.get(proposal.line_id) ?? [];
    current.push(proposal);
    grouped.set(proposal.line_id, current);
  }
  if (!grouped.size)
    return <p className={styles.hint}>没有生成可用读音候选。</p>;
  return (
    <div>
      {[...grouped.entries()].map(([lineId, proposals]) => {
        const line = document.lines.find(
          (item) => item.id === lineId || item.xmlId === lineId,
        );
        const plan = line
          ? planReadingUpdate(line, proposals)
          : {
              accepted: [],
              applied: [],
              skipped: proposals.map((item) => ({
                item,
                reason: "找不到对应歌词行",
              })),
              next: [],
            };
        return (
          <div className={styles.job} key={lineId}>
            <strong>{line?.text ?? lineId}</strong>
            {proposals.map((item) => {
              const skipped = plan.skipped.find(
                (entry) => entry.item.proposal_id === item.proposal_id,
              );
              const accepted = plan.accepted.some(
                (entry) => entry.proposal_id === item.proposal_id,
              );
              const applied = plan.applied.some(
                (entry) => entry.proposal_id === item.proposal_id,
              );
              return (
                <div className={styles.candidateRow} key={item.proposal_id}>
                  <span>
                    {item.base} → {item.reading}
                  </span>
                  <span className={styles.hint}>
                    {item.source === "dictionary" ? "词典" : "Sudachi"} ·{" "}
                    {item.needs_review ? "需复核" : "候选"}
                  </span>
                  <span className={skipped ? styles.error : styles.hint}>
                    {skipped
                      ? `跳过：${skipped.reason}`
                      : applied
                        ? "已应用"
                        : accepted
                          ? "可应用"
                          : "待处理"}
                  </span>
                </div>
              );
            })}
            <button
              className={styles.cancel}
              disabled={stale || plan.accepted.length === 0 || !line}
              onClick={() =>
                line &&
                onApply({
                  type: "update-ruby",
                  lineId: line.id,
                  ruby: plan.next,
                })
              }
            >
              应用本行读音
            </button>
            {plan.skipped.length > 0 && (
              <p className={styles.error}>
                存在重叠或正文范围不匹配的候选，已明确跳过。
              </p>
            )}
          </div>
        );
      })}
      {stale && (
        <p className={styles.error}>
          结果绑定的 revision/asset 已过期或当前有未保存修改，禁止应用。
        </p>
      )}
    </div>
  );
}

function planReadingUpdate(
  line: StudioLyricDocument["lines"][number],
  proposals: ReadingProposal[],
) {
  const accepted: ReadingProposal[] = [];
  const applied: ReadingProposal[] = [];
  const skipped: Array<{ item: ReadingProposal; reason: string }> = [];
  const existing = [...line.ruby];
  const points = Array.from(line.text);
  for (const item of [...proposals].sort(
    (a, b) => a.base_start - b.base_start || a.base_end - b.base_end,
  )) {
    const sameRange = existing.find(
      (span) =>
        span.baseStart === item.base_start && span.baseEnd === item.base_end,
    );
    const overlap = existing.find(
      (span) =>
        span.baseStart < item.base_end &&
        item.base_start < span.baseEnd &&
        !sameRange,
    );
    const candidateOverlap = accepted.find(
      (span) =>
        span.base_start < item.base_end && item.base_start < span.base_end,
    );
    if (!line.editable.text) {
      skipped.push({ item, reason: "该行注音只读" });
    } else if (
      item.base_start < 0 ||
      item.base_end <= item.base_start ||
      points.slice(item.base_start, item.base_end).join("") !== item.base
    ) {
      skipped.push({ item, reason: "正文范围不匹配" });
    } else if (sameRange?.reading === item.reading) {
      applied.push(item);
    } else if (overlap) {
      skipped.push({ item, reason: `与已有「${overlap.base}」重叠` });
    } else if (candidateOverlap) {
      skipped.push({ item, reason: "与同批候选重叠" });
    } else {
      accepted.push(item);
    }
  }
  const replacements = new Set(
    accepted.map((item) => `${item.base_start}:${item.base_end}`),
  );
  const next = existing.filter(
    (span) => !replacements.has(`${span.baseStart}:${span.baseEnd}`),
  );
  for (const item of accepted)
    next.push({
      id: `${line.id}-ruby-${item.base_start}-${item.base_end}`,
      base: item.base,
      reading: item.reading,
      baseStart: item.base_start,
      baseEnd: item.base_end,
    });
  next.sort((a, b) => a.baseStart - b.baseStart);
  return { accepted, applied, skipped, next };
}
function SearchView({ result }: { result: SearchResult }) {
  return (
    <div>
      {result.items.map((item, index) => (
        <div
          className={styles.job}
          key={`${item.candidate_id ?? "candidate"}-${index}`}
        >
          <strong>{item.title ?? "未知标题"}</strong>
          <span>
            {item.artist ?? "未知艺人"} · {item.source ?? "未知来源"}
          </span>
        </div>
      ))}
    </div>
  );
}
function FetchView({
  result,
  selected,
  onSelect,
  document,
}: {
  result: FetchResult;
  selected: number;
  onSelect: (index: number) => void;
  document: StudioLyricDocument;
}) {
  return (
    <div>
      {result.items.map((item, index) => (
        <label className={styles.job} key={index}>
          <input
            type="radio"
            checked={selected === index}
            onChange={() => onSelect(index)}
          />
          版本 {index + 1} · {item.lines?.length ?? 0} 行
          {item.lines?.slice(0, 3).map((candidate, row) => (
            <span className={styles.hint} key={row}>
              {document.lines[row]?.text ?? "新增"} → {candidate.text}
            </span>
          ))}
        </label>
      ))}
    </div>
  );
}
function TranscribeView({
  result,
  document,
}: {
  result: TranscribeResult;
  document: StudioLyricDocument;
}) {
  return (
    <div>
      {result.segments.map((item, index) => (
        <div className={styles.job} key={index}>
          <span>
            {document.lines[index]?.text ?? "新增"} → {item.text}
          </span>
          <span className={styles.hint}>
            {document.lines[index]?.beginUs == null
              ? "旧开始未知"
              : `${document.lines[index].beginUs / 1e6}s`}{" "}
            → {item.begin_us == null ? "新开始未知" : `${item.begin_us / 1e6}s`}{" "}
            · confidence {item.confidence == null ? "未知" : item.confidence}
          </span>
        </div>
      ))}
    </div>
  );
}
function AlignView({
  result,
  document,
}: {
  result: AlignResult;
  document: StudioLyricDocument;
}) {
  const rows = useMemo(
    () =>
      result.lines.map((item) => {
        const line = document.lines.find(
          (candidate) =>
            candidate.id === item.line_id || candidate.xmlId === item.line_id,
        );
        return { item, line };
      }),
    [document.lines, result.lines],
  );
  return (
    <div>
      {rows.map(({ item, line }) => (
        <div className={styles.job} key={item.line_id}>
          <span>{line?.text ?? item.line_id}</span>
          <span className={styles.hint}>
            {line?.editable.timing
              ? `${line.beginUs == null ? "旧开始未知" : `${line.beginUs / 1e6}s`} → ${item.begin_us == null ? "新开始未知" : `${item.begin_us / 1e6}s`}；${line.endUs == null ? "旧结束未知" : `${line.endUs / 1e6}s`} → ${item.end_us == null ? "新结束未知" : `${item.end_us / 1e6}s`}`
              : "时间字段只读，已跳过"}{" "}
            · score {item.score == null ? "未知" : item.score}
            {item.issues?.length ? ` · ${item.issues.join("、")}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
