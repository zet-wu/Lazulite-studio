import type { Capabilities } from "./client";
import { requestHeaders } from "./client";
import { isCapabilities } from "./validate";

export type JobRequest = {retry_analysis_id?:string; revision?:string; bound_revision?:string; devices?: Record<string, { preferred: string; actual: string; label: string; reason?: string | null }>; asset_id:string};
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
  request?: JobRequest;
  result_available?: boolean;
  error?: { code?: string; message?: string; cpu_retry?: boolean; stage?: string } | null;
};
export type JobsResponse = {
  schema_version: "studio-job-list-v1";
  items: Job[];
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
export const jobsApi = {
  retryCpu: (jobId: string, revision: string, key = crypto.randomUUID()) => call<Job>(`/jobs/${encodeURIComponent(jobId)}/retry-cpu`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ revision }) }),
  createVocal: (projectId: string, asset_id: string, retry_analysis_id?: string) => call<Job>(`/projects/${encodeURIComponent(projectId)}/jobs/vocal`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ params: { asset_id, ...(retry_analysis_id ? {retry_analysis_id} : {}) } }) }),
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
  cancel: (jobId: string) =>
    call<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
};
