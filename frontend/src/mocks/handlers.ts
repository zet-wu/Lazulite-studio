import { http, HttpResponse } from 'msw';
import { capabilities, document, emptyDocument, exports, jobs, projects, readingDictionary, sampleProject, session } from './data';

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
  http.get(`${root}/projects/:projectId/exports`, ({ params }) => params.projectId === 'sample-project' ? response(exports) : error(404, 'project_not_found', '项目不存在')),
  http.post(`${root}/projects/:projectId/publish`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const body = await request.json() as { revision?: string; asset_id?: string };
    const id = `export-${Date.now()}`;
    const revision = body.revision ?? document.revision;
    const assetId = body.asset_id ?? 'sample-asset';
    exports.items.unshift({ id, revision, asset_id: assetId, status: 'failed', created_at: new Date().toISOString(), stale: false, report: null, download_url: null, error: '演示模式不生成媒体文件，请连接真实服务发布' });
    return HttpResponse.json({ id, status: 'failed', revision, asset_id: assetId }, { status: 202 });
  }),
  http.get(`${root}/projects/:projectId/document`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(scenario() === 'empty' ? emptyDocument : currentDocument) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/waveform`, ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const query = new URL(request.url).searchParams;
    const bucket_us = 10_000 * 2 ** Number(query.get('level') ?? 8);
    const start_us = Math.floor(Number(query.get('start_us') ?? 0) / bucket_us) * bucket_us;
    const end_us = Math.ceil(Number(query.get('end_us') ?? 120_000_000) / bucket_us) * bucket_us;
    const maximum = Array.from({ length: Math.max(0, (end_us - start_us) / bucket_us) }, (_, index) => (Math.floor((start_us + index * bucket_us) / 500_000) !== Math.floor((start_us + (index - 1) * bucket_us) / 500_000) ? 0.8 : 0.1));
    return response({ schema_version: 'studio-waveform-v1', asset_id: 'sample-asset', asset_hash: 'sample', version: 'peaks-v1', level: Number(query.get('level') ?? 8), start_us, end_us, bucket_us, minimum: maximum.map((value) => -value), maximum });
  }),
  http.get(`${root}/projects/:projectId/pcm`, ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const query = new URL(request.url).searchParams;
    const start = Number(query.get('start_us') ?? 0), end = Number(query.get('end_us') ?? 0);
    if (end <= start || end - start > 4_000_000) return error(422, 'invalid_range', 'PCM 范围无效');
    const rate = 16_000;
    const pcm = Int16Array.from({ length: Math.ceil((end - start) / 1_000_000 * rate) }, (_, index) => Math.round(Math.sin(2 * Math.PI * 440 * index / rate) * 9000));
    return new HttpResponse(pcm.buffer, { headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': String(rate), 'x-channels': '1' } });
  }),
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
    const candidate = request.headers.get('content-type')?.includes('ttml')
      ? { format: 'ttml', ttml: content }
      : { format: 'text', text: content, lines: content.split(/\r?\n/).filter(Boolean).map((text, index) => ({ id: `import-${index}`, text, begin_us: null, end_us: null })) };
    return response({ schema_version: 'studio-import-v1', project_id: 'sample-project', input_revision: currentDocument.revision, candidate, diagnostics: [], saved: false });
  }),
  http.get(`${root}/projects/:projectId/review`, ({ params }) => params.projectId === 'sample-project' ? response({ schema_version: 'studio-review-v1', project_id: 'sample-project', version: 1, items: [] }) : error(404, 'project_not_found', '项目不存在')),
  http.patch(`${root}/projects/:projectId/review`, ({ params }) => params.projectId === 'sample-project' ? response({ schema_version: 'studio-review-item-v1', project_id: 'sample-project', line_id: 'line-1', revision: document.revision, version: 2, status: 'confirmed', note: null }) : error(404, 'project_not_found', '项目不存在')),
];
