import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { ApiError, studioApi } from '../adapters/http/client';
import { handlers } from './handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); window.history.replaceState({}, '', '/'); });
afterAll(() => server.close());

function scenario(value: string): void { window.history.replaceState({}, '', `/?scenario=${value}`); }

describe('MSW contract scenarios over real request paths', () => {
  it('serves normal project, job, document and direct project requests', async () => {
    const [list, project, jobs, document] = await Promise.all([studioApi.listProjects(), studioApi.getProject('sample-project'), studioApi.listJobs('sample-project'), studioApi.getDocument('sample-project')]);
    expect(list.items[0]?.id).toBe('sample-project');
    expect(project.name).toContain('星の手紙');
    expect(jobs.items[0]?.stage).toBeNull();
    expect(document.lines).toHaveLength(6);
  });

  it.each(['empty', 'error', 'expired'])('handles %s scenario with contract shaped response', async (value) => {
    scenario(value);
    if (value === 'empty') {
      await expect(studioApi.listProjects()).resolves.toMatchObject({ schema_version: 'studio-project-list-v1', items: [] });
      await expect(studioApi.getDocument('sample-project')).resolves.toMatchObject({ lines: [] });
    }
    if (value === 'error') {
      await expect(studioApi.listProjects()).rejects.toMatchObject({ status: 503, body: { code: 'service_unavailable', retryable: true } });
      await expect(studioApi.getDocument('sample-project')).rejects.toMatchObject({ status: 503, body: { code: 'service_unavailable', retryable: true } });
    }
    if (value === 'expired') await expect(studioApi.getSession()).rejects.toMatchObject({ status: 401, body: { code: 'session_expired', retryable: false } });
  });

  it('returns a unified 404 error for an unknown project', async () => {
    await expect(studioApi.getProject('missing-project')).rejects.toBeInstanceOf(ApiError);
    await expect(studioApi.getDocument('missing-project')).rejects.toMatchObject({ status: 404, body: { code: 'project_not_found', request_id: 'mock-404' } });
  });
});
