import { useEffect, useMemo, useState } from "react";
import type { StudioLyricDocument } from "../domain/document";
import type { EditCommand } from "../domain/editing";
import type {
  AlignResult,
  FetchResult,
  JobResult,
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
      ) : (
        <AlignView result={result} document={document} />
      )}
      <button
        className={styles.cancel}
        disabled={stale || result.kind === "search"}
        onClick={apply}
      >
        人工应用候选
      </button>
    </section>
  );
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
