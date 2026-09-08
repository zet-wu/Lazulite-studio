import type { components, paths } from './generated';
import { isApiError, isCapabilities, isDocumentShell, isJobList, isProjectList, isProjectSummary, isSession } from './validate';

export type Session = components['schemas']['Session'];
export type Capabilities = components['schemas']['Capabilities'];
export type ProjectList = components['schemas']['ProjectList'];
export type ProjectSummary = components['schemas']['ProjectSummary'];
export type JobList = components['schemas']['JobList'];
export type DocumentShell = components['schemas']['DocumentShell'];

const API_ROOT = '/api/v1';

async function request<T>(path: string, validate: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: 'include', headers: { 'X-Request-ID': crypto.randomUUID() } });
  if (!response.ok) {
    let error: ApiErrorBody = { code: 'http_error', message: `API request failed (${response.status})`, request_id: '', retryable: response.status >= 500 };
    try { const body: unknown = await response.json(); if (isApiError(body)) error = body; } catch { /* empty error body */ }
    throw new ApiError(response.status, error);
  }
  const value: unknown = await response.json();
  if (!validate(value)) throw new ApiError(502, { code: 'invalid_response', message: 'Studio API 返回了不支持的响应', request_id: '', retryable: false });
  return value;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) { super(body.message); }
}

export type ApiErrorBody = components['schemas']['Error'];
export const studioApi = {
  getSession: () => request('/session', isSession),
  getCapabilities: () => request('/capabilities', isCapabilities),
  listProjects: (cursor?: string) => request(`/projects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, isProjectList),
  getProject: (projectId: string) => request(`/projects/${encodeURIComponent(projectId)}`, isProjectSummary),
  listJobs: (projectId: string) => request(`/projects/${encodeURIComponent(projectId)}/jobs`, isJobList),
  getDocument: (projectId: string) => request(`/projects/${encodeURIComponent(projectId)}/document`, isDocumentShell),
};

export type StudioPaths = paths;
