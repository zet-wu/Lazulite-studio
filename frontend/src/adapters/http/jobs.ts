import type { Capabilities } from "./client";
import { requestHeaders } from "./client";
import { isCapabilities } from "./validate";

export type JobKind = "search" | "transcribe" | "align" | "reading";
export type JobRequest = {
  revision: string;
  asset_id: string;
  title?: string;
  artist?: string;
  line_ids?: string[];
};
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "cancel_requested";
export type Job = {
  schema_version?: string;
  id: string;
  project_id?: string;
  kind: string;
  status: JobStatus;
  stage?: string | null;
  completed?: number | null;
  total?: number | null;
  request?: JobRequest;
  result_available?: boolean;
  error?: { code?: string; message?: string } | null;
};
export type JobsResponse = {
  schema_version: "studio-job-list-v1";
  items: Job[];
};
export type Candidate = {
  source?: string;
  candidate_id?: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  match_score?: number | null;
  raw?: Record<string, string>;
};
export type SearchResult = {
  schema_version?: string;
  job_id?: string;
  kind: "search";
  binding?: JobBinding;
  asset?: { title?: string | null; artist?: string | null };
  items: Candidate[];
};
export type FetchResult = {
  schema_version?: string;
  job_id?: string;
  kind: "fetch";
  binding?: JobBinding;
  items: Array<{
    candidate?: Candidate;
    lines?: Array<{
      id?: string;
      text: string;
      start?: number | null;
      end?: number | null;
    }>;
  }>;
};
export type AlignmentLine = {
  line_id: string;
  begin_us?: number | null;
  end_us?: number | null;
  similarity?: number | null;
  score?: number | null;
  timing_source?: string | null;
  issues?: string[];
};
export type TranscribeResult = {
  schema_version?: string;
  job_id?: string;
  kind: "transcribe";
  binding?: JobBinding;
  segments: Array<{
    text: string;
    begin_us?: number | null;
    end_us?: number | null;
    confidence?: number | null;
    confidence_kind?: string | null;
    issues?: string[];
  }>;
};
export type AlignResult = {
  schema_version?: string;
  job_id?: string;
  kind: "line_align";
  binding?: JobBinding;
  lines: AlignmentLine[];
  reliable?: boolean;
  diagnostics?: string[];
};
export type ReadingProposal = {
  line_id: string;
  proposal_id: string;
  base_start: number;
  base_end: number;
  base: string;
  reading: string;
  source: "dictionary" | "sudachi";
  needs_review: boolean;
};
export type ReadingResult = {
  schema_version?: string;
  job_id?: string;
  kind: "reading";
  binding?: JobBinding;
  proposals: ReadingProposal[];
};
export type JobResult =
  | SearchResult
  | FetchResult
  | TranscribeResult
  | AlignResult
  | ReadingResult;
export type JobBinding = {
  revision?: string;
  asset_id?: string;
  project_id?: string;
};
const root = "/api/v1";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    credentials: "include",
    ...init,
    headers: requestHeaders({
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    }),
  });
  if (!response.ok) {
    let message = `任务请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as {
        message?: string;
        detail?: { message?: string };
      };
      message = body.message ?? body.detail?.message ?? message;
    } catch {
      /* preserve status message */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
function validate<T>(
  value: unknown,
  predicate: (value: unknown) => boolean,
  label: string,
): T {
  if (!predicate(value)) throw new Error(`任务服务返回的${label}格式无效`);
  return value as T;
}
const isJob = (value: unknown): value is Job =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  typeof value.status === "string";
const isBinding = (value: unknown) =>
  isRecord(value) &&
  typeof value.revision === "string" &&
  typeof value.asset_id === "string" &&
  typeof value.project_id === "string";
const nullableNumber = (value: unknown) =>
  value === undefined || value === null || typeof value === "number";
const isCandidate = (value: unknown) =>
  isRecord(value) &&
  nullableNumber(value.match_score) &&
  nullableNumber(value.duration);
const isResult = (value: unknown): value is JobResult => {
  if (!isRecord(value) || !isBinding(value.binding)) return false;
  if (value.kind === "search")
    return Array.isArray(value.items) && value.items.every(isCandidate);
  if (value.kind === "fetch")
    return (
      Array.isArray(value.items) &&
      value.items.every(
        (item) => isRecord(item) && (!item.lines || Array.isArray(item.lines)),
      )
    );
  if (value.kind === "transcribe")
    return (
      Array.isArray(value.segments) &&
      value.segments.every(
        (item) =>
          isRecord(item) &&
          typeof item.text === "string" &&
          nullableNumber(item.begin_us) &&
          nullableNumber(item.end_us) &&
          nullableNumber(item.confidence),
      )
    );
  if (value.kind === "line_align")
    return (
      Array.isArray(value.lines) &&
      value.lines.every(
        (item) =>
          isRecord(item) &&
          typeof item.line_id === "string" &&
          nullableNumber(item.begin_us) &&
          nullableNumber(item.end_us) &&
          nullableNumber(item.score) &&
          nullableNumber(item.similarity),
      )
      );
  if (value.kind === "reading")
    return (
      Array.isArray(value.proposals) &&
      value.proposals.every(
        (proposal) =>
          isRecord(proposal) &&
          typeof proposal.line_id === "string" &&
          typeof proposal.proposal_id === "string" &&
          Number.isSafeInteger(proposal.base_start) &&
          Number.isSafeInteger(proposal.base_end) &&
          typeof proposal.base === "string" &&
          typeof proposal.reading === "string" &&
          ["dictionary", "sudachi"].includes(String(proposal.source)) &&
          typeof proposal.needs_review === "boolean",
      )
    );
  return false;
};
export const jobsApi = {
  capabilities: () =>
    call<Capabilities>("/capabilities").then((value) =>
      validate<Capabilities>(value, isCapabilities, "能力"),
    ),
  list: (projectId: string) =>
    call<JobsResponse>(`/projects/${encodeURIComponent(projectId)}/jobs`).then(
      (value) =>
        validate<JobsResponse>(
          value,
          (item) =>
            isRecord(item) &&
            item.schema_version === "studio-job-list-v1" &&
            Array.isArray(item.items) &&
            item.items.every(isJob),
          "任务列表",
        ),
    ),
  create: (projectId: string, kind: JobKind, params: JobRequest) =>
    call<Job>(`/projects/${encodeURIComponent(projectId)}/jobs/${kind}`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ params }),
    }),
  fetch: (
    projectId: string,
    params: JobRequest & { candidates: Candidate[] },
  ) =>
    call<Job>(`/projects/${encodeURIComponent(projectId)}/jobs/fetch`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ params }),
    }),
  cancel: (jobId: string) =>
    call<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  result: (jobId: string) =>
    call<JobResult>(`/jobs/${encodeURIComponent(jobId)}/result`).then((value) =>
      validate<JobResult>(value, isResult, "任务结果"),
    ),
};
