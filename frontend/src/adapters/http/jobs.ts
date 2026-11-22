import { message, MessageError } from '../../domain/messages';
import { apiJson } from "./client";

export type JobRequest = {upload_id?:string;retry_analysis_id?:string; revision?:string; bound_revision?:string; devices?: Record<string, { preferred: string; actual: string; label: string; reason?: string | null; reason_code?: string | null }>; asset_id:string};
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";
const isJob = (value: unknown): value is Job =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  typeof value.status === "string";
const jsonHeaders = (extra?: Record<string, string>) => ({ "Content-Type": "application/json", ...extra });

export const jobsApi = {
  retryCpu: (jobId: string, revision: string, key = crypto.randomUUID()) =>
    apiJson<Job>(`/jobs/${encodeURIComponent(jobId)}/retry-cpu`, { method: 'POST', headers: jsonHeaders({ 'Idempotency-Key': key }), body: JSON.stringify({ revision }) }),
  createVocal: (projectId: string, asset_id: string, retry_analysis_id?: string, upload?: {upload_id:string;offset_ms:number}, force_separation=false) =>
    apiJson<Job>(`/projects/${encodeURIComponent(projectId)}/jobs/vocal`, { method: 'POST', headers: jsonHeaders({ 'Idempotency-Key': crypto.randomUUID() }), body: JSON.stringify({ params: { asset_id, ...(force_separation?{force_separation:true}:{}), ...upload, ...(retry_analysis_id ? {retry_analysis_id} : {}) } }) }),
  list: async (projectId: string) => {
    const value = await apiJson<unknown>(`/projects/${encodeURIComponent(projectId)}/jobs`);
    if (!isRecord(value) || value.schema_version !== "studio-job-list-v1" || !Array.isArray(value.items) || !value.items.every(isJob)) {
      throw new MessageError(message('http.taskPayload'));
    }
    return value as JobsResponse;
  },
  cancel: (jobId: string, keepalive = false) =>
    apiJson<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", keepalive }),
};
