import { useEffect, useMemo, useState } from "react";
import {
  jobsApi,
  type Candidate,
  type Job,
  type JobKind,
  type JobRequest,
  type JobResult,
  type SearchResult,
} from "../adapters/http/jobs";
import styles from "./job-panel.module.css";

type Props = {
  projectId: string;
  revision: string;
  assetId: string | null;
  dirty: boolean;
  selectedLineIds: string[];
  onCandidate: (result: JobResult) => void;
};
const labels: Record<string, string> = {
  search: "搜索取词",
  transcribe: "转写",
  align: "行对齐",
  fetch: "取词",
};
const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
  cancel_requested: "取消中",
};

export function JobPanel({
  projectId,
  revision,
  assetId,
  dirty,
  selectedLineIds,
  onCandidate,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [capabilities, setCapabilities] = useState<
    Record<string, { enabled: boolean; reason: string | null }>
  >({});
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<JobKind | null>(null);
  const [results, setResults] = useState<Record<string, JobResult>>({});
  const refresh = async () => {
    try {
      const list = await jobsApi.list(projectId);
      setJobs(list.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务状态暂不可用");
    }
  };
  useEffect(() => {
    void refresh();
    void jobsApi
      .capabilities()
      .then((caps) =>
        setCapabilities(
          Object.fromEntries(caps.items.map((item) => [item.id, item])),
        ),
      )
      .catch(() => setMessage("能力信息暂不可用"));
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [projectId]);
  const params = useMemo<JobRequest>(
    () => ({
      revision,
      asset_id: assetId ?? "",
      title: title.trim() || undefined,
      artist: artist.trim() || undefined,
      line_ids: selectedLineIds,
    }),
    [artist, assetId, revision, selectedLineIds, title],
  );
  const create = async (kind: JobKind) => {
    if (!assetId) {
      setMessage("需要先准备音频资产");
      return;
    }
    setBusy(kind);
    setMessage("");
    try {
      const job = await jobsApi.create(projectId, kind, params);
      setJobs((items) => [job, ...items.filter((item) => item.id !== job.id)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务创建失败");
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (job: Job) => {
    try {
      const next = await jobsApi.cancel(job.id);
      setJobs((items) =>
        items.map((item) => (item.id === job.id ? next : item)),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消失败");
    }
  };
  const fetchResult = async (job: Job) => {
    try {
      const result = await jobsApi.result(job.id);
      setResults((items) => ({ ...items, [job.id]: result }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "结果尚未就绪");
    }
  };
  const fetchCandidate = async (job: Job, candidate: Candidate) => {
    if (!job.request?.revision || !job.request.asset_id) {
      setMessage("任务缺少 revision/asset 绑定，不能取词");
      return;
    }
    try {
      const result = await jobsApi.fetch(projectId, {
        ...job.request,
        candidates: [candidate],
      });
      setJobs((items) => [result, ...items]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取词失败");
    }
  };
  const disabled = (kind: JobKind) =>
    !capabilities[`job.${kind}`]?.enabled ||
    busy !== null ||
    !assetId ||
    (kind === "align" && selectedLineIds.length === 0);
  return (
    <section className={styles.panel} aria-label="自动化任务">
      <div className={styles.form}>
        <label>
          歌曲标题
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="搜索取词标题"
          />
        </label>
        <label>
          艺人
          <input
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            placeholder="搜索取词艺人"
          />
        </label>
        <div className={styles.actions}>
          {(["search", "transcribe", "align"] as JobKind[]).map((kind) => (
            <button
              key={kind}
              disabled={disabled(kind)}
              onClick={() => void create(kind)}
            >
              {labels[kind]}
            </button>
          ))}{" "}
        </div>
        {(["search", "transcribe", "align"] as JobKind[]).map(
          (kind) =>
            !capabilities[`job.${kind}`]?.enabled && (
              <span className={styles.hint} key={kind}>
                {labels[kind]}：
                {capabilities[`job.${kind}`]?.reason ?? "能力不可用"}
              </span>
            ),
        )}
        {dirty && (
          <span className={styles.hint}>
            当前有未保存修改；任务会绑定已保存 revision。
          </span>
        )}
        {message && <span className={styles.error}>{message}</span>}
      </div>
      <div>
        {jobs.length === 0 ? (
          <p className={styles.hint}>暂无任务</p>
        ) : (
          jobs.map((job) => (
            <article className={styles.job} key={job.id}>
              <div className={styles.jobHead}>
                <strong>{labels[job.kind as JobKind] ?? job.kind}</strong>
                <span className={styles.status}>
                  {statusLabels[job.status] ?? job.status}
                </span>
              </div>
              {job.error?.message && (
                <span className={styles.error}>{job.error.message}</span>
              )}
              {["queued", "running", "cancel_requested"].includes(
                job.status,
              ) && (
                <button
                  className={styles.cancel}
                  onClick={() => void cancel(job)}
                >
                  取消任务
                </button>
              )}
              {job.status === "succeeded" && (
                <button
                  className={styles.cancel}
                  onClick={() => void fetchResult(job)}
                >
                  查看结果
                </button>
              )}
              {renderResult(job, results[job.id], fetchCandidate, onCandidate)}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function renderResult(
  job: Job,
  result: JobResult | undefined,
  fetchCandidate: (job: Job, candidate: Candidate) => void,
  onCandidate: (result: JobResult) => void,
) {
  if (!result) return null;
  if (result.kind === "search")
    return (
      <div>
        {result.items.map((candidate, index) => (
          <button
            className={styles.cancel}
            key={`${candidate.candidate_id ?? "candidate"}-${index}`}
            onClick={() => fetchCandidate(job, candidate)}
          >
            {candidate.title ?? "未知标题"} · {candidate.artist ?? "未知艺人"} ·{" "}
            {candidate.source ?? "未知来源"}
          </button>
        ))}
      </div>
    );
  if (result.kind === "fetch")
    return (
      <button className={styles.cancel} onClick={() => onCandidate(result)}>
        查看候选差异
      </button>
    );
  if (result.kind === "transcribe")
    return (
      <>
        <p className={styles.hint}>
          转写 {result.segments.length} 段：
          {result.segments
            .slice(0, 2)
            .map(
              (segment) =>
                `${segment.text}（${segment.confidence == null ? "置信度未知" : segment.confidence}）`,
            )
            .join("；")}
        </p>
        <button className={styles.cancel} onClick={() => onCandidate(result)}>
          查看候选差异
        </button>
      </>
    );
  return (
    <>
      <p className={styles.hint}>
        对齐 {result.lines.length} 行：
        {result.lines
          .slice(0, 2)
          .map(
            (line) =>
              `${line.line_id}（${line.score == null ? "score 未知" : line.score}${line.issues?.length ? `，${line.issues.join("、")}` : ""}）`,
          )
          .join("；")}
      </p>
      <button className={styles.cancel} onClick={() => onCandidate(result)}>
        查看候选差异
      </button>
    </>
  );
}
