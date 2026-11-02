import { MessageError, message } from '../../domain/messages';
import type { ProjectSnapshot } from '../../domain/project-document';
import type { components, paths } from "./generated";
import {
  isApiError,
  isAsset,
  isCapabilities,
  isDocumentEnvelope,
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
export type DocumentEnvelope = components["schemas"]["DocumentEnvelope"];
export type RichDocumentEnvelope = DocumentEnvelope & { source_asset_id: string | null; revision: string; etag?: string };
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
    cache: "no-store",
    signal,
    headers: requestHeaders(),
  });
  if (!response.ok) {
    throw await readApiError(response);
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
    throw await readApiError(response);
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
            apiErrorBody(body,xhr.status,xhr.getResponseHeader('X-Request-ID')??''),
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

export class ApiError extends MessageError {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(['segment_invalid_range','segment_duplicate_id','analysis_source_mismatch'].includes(body.reason??'')
      ? message(`error.document.${body.reason}`,body.params as Record<string,string|number>)
      : message(body.request_id?'error.http':'error.httpNoRequest',{status,requestId:body.request_id,diagnostic:body.message}));
    this.message=body.message;
  }
}

export type ApiErrorBody = components["schemas"]["Error"];

/** Read valid fields independently, including proxy and framework error envelopes. */
export function apiErrorBody(value: unknown, status: number, requestId=''): ApiErrorBody {
  const envelope=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const data=envelope.detail&&typeof envelope.detail==='object'?envelope.detail as Record<string,unknown>:envelope;
  return {
    code:typeof data.code==='string'?data.code:'http_error',
    message:typeof data.message==='string'?data.message:typeof envelope.detail==='string'?envelope.detail:`HTTP ${status}`,
    request_id:typeof data.request_id==='string'?data.request_id:requestId,
    retryable:typeof data.retryable==='boolean'?data.retryable:status>=500,
    ...(typeof data.reason==='string'?{reason:data.reason}:{}),
    ...(data.params&&typeof data.params==='object'&&!Array.isArray(data.params)?{params:data.params as Record<string,unknown>}:{}),
  };
}
export async function readApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try { body = await response.json(); } catch { /* HTTP errors may have no JSON body. */ }
  return new ApiError(response.status, apiErrorBody(body,response.status,response.headers.get('X-Request-ID')??''));
}

/** Only explicit document rejections prove that this snapshot was not committed. */
export function isRejectedDocument(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422 && [
    'document_invalid', 'validation_error', 'document_schema_unsupported', 'project_mismatch',
  ].includes(error.body.code);
}

export const studioApi = {
  projectStorage: (id:string) => request(`/projects/${encodeURIComponent(id)}/storage`, (value:unknown): value is components['schemas']['ProjectStorage'] => {
    const v=value as components['schemas']['ProjectStorage'];
    return !!v && Number.isSafeInteger(v.total_bytes) && v.total_bytes>=0 && typeof v.measured_at==='string' && !!v.categories && ['source','vocals','cache','snapshots','other'].every(key=>Number.isSafeInteger(v.categories[key as keyof typeof v.categories]) && v.categories[key as keyof typeof v.categories]>=0) && Object.values(v.categories).reduce((a,b)=>a+b,0)===v.total_bytes;
  }),
  importProject: (file: File) => {
    const body = new FormData(); body.append('file', file);
    return mutate('/project-archives', { method: 'POST', body }, isProjectSummary);
  },
  exportProject: async (id: string) => {
    const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(id)}/archive`, { credentials:'include', headers:requestHeaders() });
    if (!response.ok) throw await readApiError(response);
    return response.blob();
  },
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
  cleanupMusic: (projectId:string) => s4<{cleanup_pending:boolean}>(`/projects/${encodeURIComponent(projectId)}/music-cleanup`,{method:'POST'}),
  attachMusic: (projectId: string, request: {upload_id:string;revision:string;expected_asset_id:string|null;operation_id:string}) => s4<{asset:Asset;revision:string;cleanup_pending:boolean}>(`/projects/${encodeURIComponent(projectId)}/music`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request) }),
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
  audioUrl: (projectId: string, vocal?: string | null, source?: string) =>
    `${API_ROOT}/projects/${encodeURIComponent(projectId)}/audio?source=${encodeURIComponent(source??'')}${vocal ? `&vocal=${encodeURIComponent(vocal)}` : ""}`,
  getPcmWindow: async (projectId: string, startMs: number, endMs: number, signal?: AbortSignal, vocal?: string | null) => {
    const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/pcm?start_ms=${startMs}&end_ms=${endMs}${vocal ? `&vocal=${encodeURIComponent(vocal)}` : ""}`, { credentials: 'include', cache:'no-store', signal });
    if (!response.ok) throw await readApiError(response);
    const rate = Number(response.headers.get('x-sample-rate'));
    const channels = Number(response.headers.get('x-channels'));
    if (!Number.isSafeInteger(rate) || rate < 1000 || !Number.isSafeInteger(channels) || channels < 1 || channels > 8) throw new MessageError(message('http.pcmHeaders'));
    return { pcm: await response.arrayBuffer(), rate, channels };
  },
};

export type StudioPaths = paths;

export type SaveDocumentResult = components["schemas"]["DocumentSaveResponse"];
export type JobResult = components["schemas"]["JobResult"];
const s4 = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: 'include', ...init, headers: requestHeaders(init.headers) });
  if (!response.ok) throw await readApiError(response);
  return (await response.json()) as T;
};

export const studioS4 = {
  getDocumentEnvelope: async (projectId: string): Promise<RichDocumentEnvelope> => {
    const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/document`, { credentials: "include", headers: requestHeaders() });
    if (!response.ok) throw await readApiError(response);
    const body: unknown = await response.json();
    if (!isDocumentEnvelope(body) || !body.revision) throw new ApiError(502, { code: "invalid_response", message: "文档响应无有效 revision", request_id: "", retryable: false });
    return { ...body, source_asset_id: body.source_asset_id, revision: body.revision, etag: response.headers.get("ETag") ?? undefined };
  },
  saveRichDocument: async (projectId: string, document: ProjectSnapshot, baseRevision: string, operationId: string, seq: number, etag?: string) => { const result = await s4<unknown>(`/projects/${encodeURIComponent(projectId)}/document`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag ?? `"${baseRevision}"`, "Idempotency-Key": operationId }, body: JSON.stringify({ schema_version: "studio-document-v9", project_id: projectId, revision: baseRevision, client_seq: seq, document }) }); if (!result || typeof result !== 'object' || !('revision' in result) || typeof result.revision !== 'string' || !result.revision) throw new ApiError(502, { code: "invalid_response", message: "保存响应无有效 revision", request_id: "", retryable: false }); return { revision: result.revision, etag: `"${result.revision}"` }; },
};

export type VocalResult = components['schemas']['VocalResult'];
export const vocalApi = {
  jobResult: (id: string) => s4<{kind: 'vocal'; analysis_id: string}>(`/jobs/${encodeURIComponent(id)}/result`),
  list: (pid: string) => s4<components['schemas']['VocalResults']>(`/projects/${encodeURIComponent(pid)}/vocals`),
  energy: (pid: string, rid: string, start: number, end: number, signal?: AbortSignal) => s4<components['schemas']['VocalEnergyWindow']>(`/projects/${encodeURIComponent(pid)}/vocals/${encodeURIComponent(rid)}/energy?start_ms=${start}&end_ms=${end}&buckets=1000`, { signal }),
};
