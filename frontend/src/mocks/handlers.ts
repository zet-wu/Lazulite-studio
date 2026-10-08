import { http, HttpResponse } from 'msw';
import { capabilities, document, emptyDocument, exports, jobs, projects, sampleProject, session } from './data';

const root = '/api/v1';
const scenario = () => new URL(location.href).searchParams.get('scenario') ?? 'normal';
const response = <T>(body: T) => scenario() === 'loading' ? new Promise<never>(() => undefined) : HttpResponse.json(body as Record<string, unknown>);
const error = (status: number, code: string, message: string, retryable = false) => HttpResponse.json({ code, message, request_id: `mock-${status}`, retryable }, { status });
let currentDocument: typeof document = JSON.parse(sessionStorage.getItem('studio-mock-document') ?? 'null') ?? document;
let searchConditions={title:'',artist:'',album:''};

export const handlers = [
  http.get(`${root}/projects/:projectId/embedded-lyrics`, () => response({ asset_id: 'sample-asset', candidates: [
    { id: 'one', label: 'USLT · eng', format: 'elrc', content: '[00:01.000]<00:01.000>Hello<00:02.000> world<00:03.000>' },
    { id: 'two', label: 'USLT · jpn', format: 'lrc', content: '[00:02.000]別の歌詞' },
  ] })),
  http.get(`${root}/projects/:projectId/vocals`, () => HttpResponse.json({items:[]})),
  http.get(`${root}/projects/:projectId/search-conditions`, () => response(searchConditions)),
  http.put(`${root}/projects/:projectId/search-conditions`, async ({request}) => { searchConditions=await request.json() as typeof searchConditions; return response(searchConditions); }),
  http.get(`${root}/session`, () => scenario() === 'expired' ? error(401, 'session_expired', '登录已过期') : response(session)),
  http.get(`${root}/capabilities`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : response(capabilities)),
  http.get(`${root}/projects`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : scenario() === 'empty' ? response({ schema_version: 'studio-project-list-v1', items: [], next_cursor: null }) : response(projects)),
  http.get(`${root}/projects/:projectId`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(scenario() === 'no-music' ? { ...sampleProject, asset: null } : scenario() === 'long' ? { ...sampleProject, asset: { ...sampleProject.asset, duration_ms: 1_800_000 } } : sampleProject) : error(404, 'project_not_found', '项目不存在')),
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
    const bucket_ms = 10 * 2 ** Number(query.get('level') ?? 8);
    const start_ms = Math.floor(Number(query.get('start_ms') ?? 0) / bucket_ms) * bucket_ms;
    const end_ms = Math.ceil(Number(query.get('end_ms') ?? 120_000) / bucket_ms) * bucket_ms;
    const maximum = Array.from({ length: Math.max(0, (end_ms - start_ms) / bucket_ms) }, (_, index) => (Math.floor((start_ms + index * bucket_ms) / 500) !== Math.floor((start_ms + (index - 1) * bucket_ms) / 500) ? 0.8 : 0.1));
    return response({ schema_version: 'studio-waveform-v1', asset_id: 'sample-asset', asset_hash: 'sample', version: 'peaks-v1', level: Number(query.get('level') ?? 8), start_ms, end_ms, bucket_ms, minimum: maximum.map((value) => -value), maximum });
  }),
  http.get(`${root}/projects/:projectId/pcm`, ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const query = new URL(request.url).searchParams;
    const start = Number(query.get('start_ms') ?? 0), end = Number(query.get('end_ms') ?? 0);
    if (end <= start || end - start > 4_020) return error(422, 'invalid_range', 'PCM 范围无效');
    const rate = 48_000;
    const pcm = Int16Array.from({ length: Math.round(end / 1_000 * rate) - Math.round(start / 1_000 * rate) }, (_, index) => Math.round(Math.sin(2 * Math.PI * 440 * (index + Math.round(start / 1_000 * rate)) / rate) * 9000));
    return new HttpResponse(pcm.buffer, { headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': String(rate), 'x-channels': '1' } });
  }),
  http.put(`${root}/projects/:projectId/document`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const body = await request.json() as { revision?: string; document?: typeof currentDocument.document };
    currentDocument = { ...currentDocument, revision: 'sample-r2', document: body.document ?? currentDocument.document };
    sessionStorage.setItem('studio-mock-document', JSON.stringify(currentDocument));
    const next = currentDocument;
    return HttpResponse.json(next, { headers: { ETag: '"sample-r2"' } });
  }),
  http.post(`${root}/projects/:projectId/imports`, async ({ params, request }) => {
    if (params.projectId !== 'sample-project') return error(404, 'project_not_found', '项目不存在');
    const content = await request.text();
    const candidate = request.headers.get('content-type')?.includes('ttml')
      ? { format: 'ttml', ttml: content }
      : { format: 'text', text: content, lines: content.split(/\r?\n/).filter(Boolean).map((text, index) => ({ id: `import-${index}`, text, begin_ms: null, end_ms: null })) };
    return response({ schema_version: 'studio-import-v1', project_id: 'sample-project', input_revision: currentDocument.revision, candidate, diagnostics: [], saved: false });
  }),
];
