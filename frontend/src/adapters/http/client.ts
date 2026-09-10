import type { components, paths } from "./generated";
import {
  isApiError,
  isAsset,
  isCapabilities,
  isDocumentShell,
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
export type Asset = components["schemas"]["Asset"];
export type WaveformWindow = components["schemas"]["WaveformWindow"];

const API_ROOT = "/api/v1";
const csrf = () =>
  document.cookie.match(/(?:^|; )studio_csrf=([^;]+)/)?.[1] ?? "";
const requestHeaders = (extra: HeadersInit = {}) => ({
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

export function uploadAsset(
  file: File,
  onProgress: (value: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_ROOT}/assets`);
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
  createProject: (
    name: string,
    sourceAssetId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
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
        body: JSON.stringify({ name, source_asset_id: sourceAssetId }),
      },
      isProjectSummary,
    ),
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
      isDocumentShell,
    ),
  getWaveform: (
    projectId: string,
    startUs = 0,
    endUs?: number,
    level = 8,
    signal?: AbortSignal,
  ) =>
    request(
      `/projects/${encodeURIComponent(projectId)}/waveform?level=${level}&start_us=${startUs}${endUs == null ? "" : `&end_us=${endUs}`}`,
      isWaveformWindow,
      signal,
    ),
  audioUrl: (projectId: string) =>
    `${API_ROOT}/projects/${encodeURIComponent(projectId)}/audio`,
};

export type StudioPaths = paths;
