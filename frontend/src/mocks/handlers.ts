import { http, HttpResponse } from 'msw';
import { capabilities, document, emptyDocument, jobs, projects, sampleProject, session } from './data';

const root = '/api/v1';
const scenario = () => new URL(location.href).searchParams.get('scenario') ?? 'normal';
const response = <T>(body: T) => scenario() === 'loading' ? new Promise<never>(() => undefined) : HttpResponse.json(body as Record<string, unknown>);
const error = (status: number, code: string, message: string, retryable = false) => HttpResponse.json({ code, message, request_id: `mock-${status}`, retryable }, { status });

export const handlers = [
  http.get(`${root}/session`, () => scenario() === 'expired' ? error(401, 'session_expired', '登录已过期') : response(session)),
  http.get(`${root}/capabilities`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : response(capabilities)),
  http.get(`${root}/projects`, () => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : scenario() === 'empty' ? response({ schema_version: 'studio-project-list-v1', items: [], next_cursor: null }) : response(projects)),
  http.get(`${root}/projects/:projectId`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(sampleProject) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/jobs`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(jobs) : error(404, 'project_not_found', '项目不存在')),
  http.get(`${root}/projects/:projectId/document`, ({ params }) => scenario() === 'error' ? error(503, 'service_unavailable', '服务暂不可用', true) : params.projectId === 'sample-project' ? response(scenario() === 'empty' ? emptyDocument : document) : error(404, 'project_not_found', '项目不存在')),
];
