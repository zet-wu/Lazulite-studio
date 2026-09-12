import { http, HttpResponse } from 'msw';
import { capabilities, document, emptyDocument, jobs, projects, readingDictionary, sampleProject, session } from './data';

const root = '/api/v1';
const scenario = () => new URL(location.href).searchParams.get('scenario') ?? 'normal';
const response = <T>(body: T) => scenario() === 'loading' ? new Promise<never>(() => undefined) : HttpResponse.json(body as Record<string, unknown>);
const error = (status: number, code: string, message: string, retryable = false) => HttpResponse.json({ code, message, request_id: `mock-${status}`, retryable }, { status });
let currentDocument = document;

export const handlers = [
  http.get(`${root}/session`, () => scenario() === 'expired' ? error(401, 'session_expired', '登录已过期') : response(session)),
  http.get(`${root}/capabilities`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : response(capabilities)),
  http.get(`${root}/projects`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : scenario() === 'empty' ? response({ schema_version: 'studio-project-list-v1', items: [], next_cursor: null }) : response(projects)),
  http.get(`${root}/projects/:projectId`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(sampleProject) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/jobs`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(jobs) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/document`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(scenario() === 'empty' ? emptyDocument : currentDocument) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/reading-dictionary`, ({ params }) => params.projectId === 'sample-project' ? response(readingDictionary) : error(404, 'project_not_found', '项目不存在')),
  http.post(`${root}/projects/:projectId/reading-dictionary`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const body = await request.json() as { surface?: string; reading?: string };
    const entry = { schema_version: 'studio-reading-dictionary-entry-v1' as const, project_id: 'sample-project', id: `dictionary-${Date.now()}`, surface: body.surface ?? '', reading: body.reading ?? '', updated_at: new Date().toISOString() };
    readingDictionary.items.push(entry);
    return HttpResponse.json(entry, { status: 201 });
  }),
  http.put(`${root}/projects/:projectId/reading-dictionary/:entryId`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const body = await request.json() as { surface?: string; reading?: string };
    const entry = readingDictionary.items.find((item) => item.id === params.entryId);
    if (!entry) return error(404, 'dictionary_entry_not_found', '词典项不存在');
    entry.surface = body.surface ?? entry.surface; entry.reading = body.reading ?? entry.reading; entry.updated_at = new Date().toISOString();
    return HttpResponse.json(entry);
  }),
  http.delete(`${root}/projects/:projectId/reading-dictionary/:entryId`, ({ params }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const index = readingDictionary.items.findIndex((item) => item.id === params.entryId);
    if (index < 0) return error(404, 'dictionary_entry_not_found', '词典项不存在');
    readingDictionary.items.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${root}/projects/:projectId/document`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const body = await request.json() as { revision?: string; document?: { ttml?: string } };
    currentDocument = { ...currentDocument, revision: 'sample-r2', document: { ...currentDocument.document, ttml: body.document?.ttml ?? currentDocument.document.ttml } };
    const next = currentDocument;
    return HttpResponse.json(next, { headers: { ETag: '"sample-r2"' } });
  }),
  http.post(`${root}/projects/:projectId/imports`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const content = await request.text();
    return response({ schema_version: 'studio-import-v1', project_id: 'sample-project', input_revision: document.revision, candidate: { format: 'text', text: content, lines: content.split(/\r?\n/).filter(Boolean).map((text, index) => ({ id: `import-${index}`, text, begin_us: null, end_us: null })) }, diagnostics: [], saved: false });
  }),
  http.get(`${root}/projects/:projectId/review`, ({ params }) => params.projectId === 'sample-project' ? response({ schema_version: 'studio-review-v1', project_id: 'sample-project', version: 1, items: [] }) : error(404, 'project_not_found', '项目不存在')),
  http.patch(`${root}/projects/:projectId/review`, ({ params }) => params.projectId === 'sample-project' ? response({ schema_version: 'studio-review-item-v1', project_id: 'sample-project', line_id: 'line-1', revision: document.revision, version: 2, status: 'confirmed', note: null }) : error(404, 'project_not_found', '项目不存在')),
];
