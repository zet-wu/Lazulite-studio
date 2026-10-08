import type { ProjectSnapshot } from '../../domain/project-document';
import type { components, paths } from "./generated";
import {
  isApiError,
  isAsset,
  isCapabilities,
  isDocumentShell,
  isDocumentEnvelope,
  isImportCandidate,
  isJobList,
  isProjectList,
  isProjectSummary,
  isSession,
  isWaveformWindow,
} from "./validate";

export type Session = components["schemas"]["Session"];
export type Capabilities = components["schemas"]["Capabilities"];
export type ProjectList = components["schemas"]["ProjectList"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type JobList = components["schemas"]["JobList"];
export type DocumentShell = components["schemas"]["DocumentShell"];
export type DocumentEnvelope = components["schemas"]["DocumentEnvelope"];
export type RichDocumentEnvelope = DocumentEnvelope & { revision: string; etag?: string };
export type Asset = components["schemas"]["Asset"];
export type WaveformWindow = components["schemas"]["WaveformWindow"];

const API_ROOT = "/api/v1";
const csrf = () =>
  document.cookie.match(/(?:^|; )studio_csrf=([^;]+)/)?.[1] ?? "";
export const requestHeaders = (extra: HeadersInit = {}) => ({
  "X-Request-ID": crypto.randomUUID(),
  ...(csrf() ? { "X-CSRF-Token": decodeURIComponent(csrf()) } : {}),
  ...extra,
});

async function request<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
    signal,
    headers: requestHeaders(),
  });
  if (!response.ok) {
    let error: ApiErrorBody = {
      code: "http_error",
      message: `API request failed (${response.status})`,
      request_id: "",
      retryable: response.status >= 500,
    };
    try {
      const body: unknown = await response.json();
      if (isApiError(body)) error = body;
    } catch {
      /* empty error body */
    }
    throw new ApiError(response.status, error);
  }
  const value: unknown = await response.json();
  if (!validate(value))
    throw new ApiError(502, {
      code: "invalid_response",
      message: "Studio API 返回了不支持的响应",
      request_id: "",
      retryable: false,
    });
  return value;
}

async function mutate<T>(
  path: string,
  init: RequestInit,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
    ...init,
    headers: requestHeaders(init.headers),
  });
  if (!response.ok) {
    let error: ApiErrorBody = {
      code: "http_error",
      message: `API request failed (${response.status})`,
      request_id: "",
      retryable: response.status >= 500,
    };
    try {
      const body: unknown = await response.json();
      if (isApiError(body)) error = body;
    } catch {
      /* empty error body */
    }
    throw new ApiError(response.status, error);
  }
  const value: unknown = await response.json();
  if (!validate(value))
    throw new ApiError(502, {
      code: "invalid_response",
      message: "Studio API 返回了不支持的响应",
      request_id: "",
      retryable: false,
    });
  return value;
}

export function uploadMusic(
  file: File,
  onProgress: (value: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_ROOT}/uploads`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Request-ID", crypto.randomUUID());
    if (csrf())
      xhr.setRequestHeader("X-CSRF-Token", decodeURIComponent(csrf()));
    xhr.setRequestHeader("Idempotency-Key", crypto.randomUUID());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () =>
      reject(
        new ApiError(xhr.status || 0, {
          code: "network_error",
          message: "上传失败，请重试",
          request_id: "",
          retryable: true,
        }),
      );
    xhr.onabort = () =>
      reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            xhr.status,
            isApiError(body)
              ? body
              : {
                  code: "upload_failed",
                  message: "上传失败，请重试",
                  request_id: "",
                  retryable: xhr.status >= 500,
                },
          ),
        );
        return;
      }
      if (isAsset(body)) {
        onProgress(1);
        resolve(body);
      } else
        reject(
          new ApiError(502, {
            code: "invalid_response",
            message: "上传服务返回了不支持的响应",
            request_id: "",
            retryable: false,
          }),
        );
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export type ApiErrorBody = components["schemas"]["Error"];
export const studioApi = {
  getSession: () => request("/session", isSession),
  login: (password: string, username?: string) =>
    mutate(
      "/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(username ? { username, password } : { password }),
      },
      isSession,
    ),
  discardUpload: (id: string) => s4<{cancelled:string}>(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  attachMusic: (projectId: string, uploadId: string) => s4<Asset>(`/projects/${encodeURIComponent(projectId)}/music`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: uploadId }) }),
  createProject: (
    name: string,
    uploadId: string | null,
    idempotencyKey: string,
    signal?: AbortSignal,
    sourceFilename?: string,
  ) =>
    mutate(
      "/projects",
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ name, upload_id: uploadId, source_filename: sourceFilename }),
      },
      isProjectSummary,
    ),
  deleteProject: (projectId: string) => mutate(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }, (value: unknown): value is {deleted: string} => !!value && typeof value === 'object' && typeof (value as {deleted?: unknown}).deleted === 'string'),
  getCapabilities: () => request("/capabilities", isCapabilities),
  listProjects: (cursor?: string) =>
    request(
      `/projects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      isProjectList,
    ),
  getProject: (projectId: string) =>
    request(`/projects/${encodeURIComponent(projectId)}`, isProjectSummary),
  listJobs: (projectId: string) =>
    request(`/projects/${encodeURIComponent(projectId)}/jobs`, isJobList),
  getDocument: (projectId: string) =>
    request(
      `/projects/${encodeURIComponent(projectId)}/document`,
      isDocumentEnvelope,
    ),
  getWaveform: (
    projectId: string,
    startMs = 0,
    endMs?: number,
    level = 8,
    signal?: AbortSignal,
    vocal?: string | null,
  ) =>
    request(
      `/projects/${encodeURIComponent(projectId)}/waveform?level=${level}&start_ms=${startMs}${endMs == null ? "" : `&end_ms=${endMs}`}${vocal ? `&vocal=${encodeURIComponent(vocal)}` : ""}`,
      isWaveformWindow,
      signal,
    ),
  audioUrl: (projectId: string, vocal?: string | null) =>
    `${API_ROOT}/projects/${encodeURIComponent(projectId)}/audio${vocal ? `?vocal=${encodeURIComponent(vocal)}` : ""}`,
  getPcmWindow: async (projectId: string, startMs: number, endMs: number, signal?: AbortSignal, vocal?: string | null) => {
    const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/pcm?start_ms=${startMs}&end_ms=${endMs}${vocal ? `&vocal=${encodeURIComponent(vocal)}` : ""}`, { credentials: 'include', signal });
    if (!response.ok) throw new Error(`PCM window request failed: ${response.status}`);
    const rate = Number(response.headers.get('x-sample-rate'));
    const channels = Number(response.headers.get('x-channels'));
    if (!Number.isSafeInteger(rate) || rate < 1000 || !Number.isSafeInteger(channels) || channels < 1 || channels > 8) throw new Error('Invalid PCM window headers');
    return { pcm: await response.arrayBuffer(), rate, channels };
  },
};

export type StudioPaths = paths;

export type SaveDocumentResult = components["schemas"]["DocumentSaveResponse"];
export type ImportLine = { id?: string; text: string; begin_ms?: number | null; end_ms?: number | null; changed?: boolean };
export type ImportProposal = { schema_version: string; project_id: string; input_revision: string | null; candidate: { format: "ttml" | "lrc" | "text"; ttml?: string; text?: string; lines?: ImportLine[] }; diagnostics: Array<{ code?: string; message?: string }>; saved: false };
export type JobResult = components["schemas"]["JobResult"];
const s4 = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: 'include', ...init, headers: requestHeaders(init.headers) });
  if (!response.ok) throw new ApiError(response.status, { code: response.status === 412 ? 'revision_conflict' : 's4_request_failed', message: response.status === 412 ? '文档已在其他标签页更新' : '请求失败，请重试', request_id: '', retryable: response.status >= 500 });
  return (await response.json()) as T;
};

export const studioS4 = {
  getDocumentEnvelope: async (projectId: string): Promise<RichDocumentEnvelope> => {
    const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/document`, { credentials: "include", headers: requestHeaders() });
    if (!response.ok) throw new ApiError(response.status, { code: "document_failed", message: "文档加载失败", request_id: "", retryable: response.status >= 500 });
    const body: unknown = await response.json();
    if (!isDocumentEnvelope(body) || !body.revision) throw new ApiError(502, { code: "invalid_response", message: "文档响应无有效 revision", request_id: "", retryable: false });
    return { ...body, revision: body.revision, etag: response.headers.get("ETag") ?? undefined };
  },
  saveRichDocument: async (projectId: string, document: ProjectSnapshot, baseRevision: string, operationId: string, seq: number, etag?: string) => { const result = await s4<unknown>(`/projects/${encodeURIComponent(projectId)}/document`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag ?? `"${baseRevision}"`, "Idempotency-Key": operationId }, body: JSON.stringify({ schema_version: "studio-document-v6", project_id: projectId, revision: baseRevision, client_seq: seq, document }) }); if (!isDocumentEnvelope(result) || !result.revision) throw new ApiError(502, { code: "invalid_response", message: "保存响应无有效 revision", request_id: "", retryable: false }); return { revision: result.revision, etag: `"${result.revision}"` }; },
  importLyrics: async (projectId: string, revision: string, filename: string, content: string) => { const result = await s4<unknown>(`/projects/${encodeURIComponent(projectId)}/imports?revision=${encodeURIComponent(revision)}`, { method: 'POST', headers: { 'Content-Type': filename.endsWith("ttml") || filename.endsWith("xml") ? "application/ttml+xml" : filename.endsWith(".lrc") ? "text/lrc" : "text/plain", 'Idempotency-Key': crypto.randomUUID() }, body: content }); if (!isImportCandidate(result)) throw new ApiError(502, { code: "invalid_response", message: "导入响应格式无效", request_id: "", retryable: false }); return result; },
};

export type VocalResult = components['schemas']['VocalResult'];
export const vocalApi = {
  jobResult: (id: string) => s4<{kind: 'vocal'; analysis_id: string}>(`/jobs/${encodeURIComponent(id)}/result`),
  list: (pid: string) => s4<components['schemas']['VocalResults']>(`/projects/${encodeURIComponent(pid)}/vocals`),
  energy: (pid: string, rid: string, start: number, end: number, signal?: AbortSignal) => s4<components['schemas']['VocalEnergyWindow']>(`/projects/${encodeURIComponent(pid)}/vocals/${encodeURIComponent(rid)}/energy?start_ms=${start}&end_ms=${end}&buckets=1000`, { signal }),
};
