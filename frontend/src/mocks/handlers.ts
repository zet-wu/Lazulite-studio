import { http, HttpResponse } from 'msw';
import { capabilities, document, emptyDocument, jobs, projects, sampleProject, session } from './data';

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
