import { ApiError } from './client';

export type ReviewItem = { line_id: string; revision: string; status: 'confirmed' | 'open' | 'stale'; note: string | null };
export type ReviewSnapshot = { schema_version: 'studio-review-v1'; project_id: string; version: number; items: ReviewItem[] };
const root = '/api/v1';
const headers = () => ({ 'X-Request-ID': crypto.randomUUID(), ...(document.cookie.match(/(?:^|; )studio_csrf=([^;]+)/) ? { 'X-CSRF-Token': decodeURIComponent(document.cookie.match(/(?:^|; )studio_csrf=([^;]+)/)![1]) } : {}) });
async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status, await response.json());
  return response.json() as Promise<T>;
}
export const reviewApi = {
  get: (projectId: string) => fetch(`${root}/projects/${encodeURIComponent(projectId)}/review`, { credentials: 'include', headers: headers() }).then((r) => parse<ReviewSnapshot>(r)),
  patch: (projectId: string, lineId: string, revision: string, version: number, confirmed: boolean, note: string) => fetch(`${root}/projects/${encodeURIComponent(projectId)}/review`, { method: 'PATCH', credentials: 'include', headers: { ...headers(), 'Content-Type': 'application/json', 'If-Match': `"${version}"` }, body: JSON.stringify({ line_id: lineId, document_revision: revision, confirmed, note: note || null }) }).then((r) => parse<ReviewItem & { version: number }>(r)),
};
