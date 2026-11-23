import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../../frontend/src/adapters/project-codec';
import { createLyricDocument, createWord } from '../../frontend/src/domain/lyric-document';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { StudioClient, StudioHttpError } from '../src/client';
import { createToolRegistry } from '../src/mcp-server';
import { installXmlDomShim } from '../src/xml-shim';

installXmlDomShim();

function createAlignmentServerMock() {
  const lyrics = createLyricDocument('');
  const lineId = lyrics.lines[0].id;
  const word = {
    ...createWord('今日', 'w1'),
    rubyUnits: [
      { id: 'r1', reading: 'きょ', beginMs: null, endMs: null },
      { id: 'r2', reading: 'う', beginMs: null, endMs: null },
    ],
  };
  lyrics.lines[0].words = [word];
  const initialDoc = createProjectDocument(lyrics);

  let revision = 'rev-1';
  let snapshot = serializeProject(initialDoc);
  let activeJob: Record<string, unknown> | null = null;
  let jobCounter = 0;
  let failNextAcknowledge = false;
  let putCount = 0;
  const acknowledgements: Array<{ jobId: string; state: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/alignment-models' && method === 'GET') {
      return Response.json({
        directory: '/models',
        source: 'default',
        editable: true,
        error: null,
        items: [{ id: 'ja-mfa', name: 'Japanese MFA', type: 'mfa', status: 'ready' }],
      });
    }

    if (path === '/api/v1/projects/p1' && method === 'GET') {
      return Response.json({
        schema_version: 'studio-project-v1',
        id: 'p1',
        name: 'Alignment Sample',
        updated_at: '2026-11-22T00:00:00Z',
        asset: {
          id: 'asset-1',
          filename: 'song.flac',
          duration_ms: 10000,
          source_duration_ms: 10000,
        },
      });
    }

    if (path === '/api/v1/projects/p1/document' && method === 'GET') {
      return new Response(
        JSON.stringify({
          schema_version: 'studio-document-v9',
          project_id: 'p1',
          revision,
          document: snapshot,
          source_asset_id: 'asset-1',
        }),
        { status: 200, headers: { ETag: `"${revision}"` } },
      );
    }

    if (path === '/api/v1/projects/p1/document' && method === 'PUT') {
      const headers = new Headers(init?.headers);
      const ifMatch = headers.get('If-Match');
      if (ifMatch !== `"${revision}"` && ifMatch !== revision) {
        return new Response(
          JSON.stringify({
            detail: {
              code: 'revision_conflict',
              message: 'Revision mismatch',
              retryable: false,
              current_revision: revision,
            },
          }),
          { status: 412 },
        );
      }
      const body = JSON.parse(String(init?.body)) as { document: typeof snapshot };
      putCount += 1;
      snapshot = body.document;
      revision = `rev-${Number(revision.split('-')[1]) + 1}`;
      return new Response(JSON.stringify({ revision }), {
        status: 200,
        headers: { ETag: `"${revision}"` },
      });
    }

    if (path === '/api/v1/projects/p1/alignment-preview' && method === 'GET') {
      return Response.json({
        model_preview: 'preview-token-1',
        line_count: 1,
        skipped_count: 0,
        unknown_count: 0,
        hint_count: 0,
        emitting_count: 2,
      });
    }

    if (path === '/api/v1/projects/p1/jobs' && method === 'GET') {
      return Response.json({
        schema_version: 'studio-job-list-v1',
        items: activeJob ? [activeJob] : [],
      });
    }

    if (path === '/api/v1/projects/p1/jobs/alignment' && method === 'POST') {
      if (activeJob && ['queued', 'running', 'cancel_requested'].includes(String(activeJob.status))) {
        return new Response(
          JSON.stringify({ detail: { code: 'conflict', message: 'busy', retryable: true } }),
          { status: 409 },
        );
      }
      const body = JSON.parse(String(init?.body)) as { params: Record<string, unknown> };
      jobCounter += 1;
      activeJob = {
        schema_version: 'studio-job-v1',
        id: `job-${jobCounter}`,
        project_id: 'p1',
        kind: 'alignment',
        status: 'queued',
        stage: 'preparing',
        progress: 0.1,
        acknowledged_state: null,
        request: body.params,
        result_available: false,
        error: null,
        engine: { device: 'cpu' },
        created_at: '2026-11-22T00:00:00Z',
        updated_at: '2026-11-22T00:00:00Z',
      };
      return Response.json(activeJob, { status: 202 });
    }

    const jobMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)(?:\/(cancel|acknowledge|result))?$/);
    if (jobMatch && activeJob && jobMatch[1] === activeJob.id) {
      const action = jobMatch[2];
      if (!action && method === 'GET') {
        return Response.json(activeJob);
      }
      if (action === 'cancel' && method === 'POST') {
        activeJob = { ...activeJob, status: 'cancelled', stage: 'cancelled' };
        return Response.json(activeJob);
      }
      if (action === 'acknowledge' && method === 'POST') {
        if (failNextAcknowledge) {
          failNextAcknowledge = false;
          return Response.json(
            { detail: { code: 'service_unavailable', message: 'Temporary failure', retryable: true } },
            { status: 503 },
          );
        }
        const body = JSON.parse(String(init?.body)) as { state: string };
        acknowledgements.push({ jobId: String(activeJob.id), state: body.state });
        activeJob = { ...activeJob, acknowledged_state: body.state };
        return Response.json(activeJob);
      }
      if (action === 'result' && method === 'GET') {
        return Response.json({
          schema_version: 'studio-job-result-v1',
          job_id: activeJob.id,
          kind: 'alignment',
          binding: {
            project_id: 'p1',
            revision: String((activeJob.request as Record<string, unknown>).revision ?? 'rev-1'),
            asset_id: 'asset-1',
          },
          alignment: {
            schema: 'lazulite-japanese-result-v1',
            units: [
              { unit_id: 'u1', line_id: lineId, proposed_timing: { start: { time: 0.5, source: 'model' }, end: { time: 0.9, source: 'model' } } },
              { unit_id: 'u2', line_id: lineId, proposed_timing: { start: { time: 0.95, source: 'model' }, end: { time: 1.4, source: 'model' } } },
            ],
          },
          mapping: [
            { unit_id: 'u1', object_id: 'r1', word_id: 'w1', line_id: lineId, kind: 'ruby' },
            { unit_id: 'u2', object_id: 'r2', word_id: 'w1', line_id: lineId, kind: 'ruby' },
          ],
          scope: [
            { object_id: 'r1', word_id: 'w1', line_id: lineId, kind: 'ruby', target_ids: ['u1'] },
            { object_id: 'r2', word_id: 'w1', line_id: lineId, kind: 'ruby', target_ids: ['u2'] },
          ],
          acoustics: {
            analysisId: 'vocal-1',
            segments: [{ id: 'seg-1', beginMs: 400, endMs: 1600, confidence: 0.9 }],
          },
        });
      }
    }

    return new Response(JSON.stringify({ code: 'not_found', message: 'Not found', retryable: false }), {
      status: 404,
    });
  };

  return {
    client: new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl }),
    markJobSucceeded: () => {
      if (activeJob) {
        activeJob = { ...activeJob, status: 'succeeded', stage: 'done', result_available: true };
      }
    },
    advanceExternalRevision: () => {
      revision = 'rev-2';
    },
    failNextAcknowledge: () => {
      failNextAcknowledge = true;
    },
    getPutCount: () => putCount,
    getCurrentDoc: () => parseProject(snapshot),
    acknowledgements,
  };
}

describe('Milestone 5 alignment tools', () => {
  it('orchestrates list -> preview -> start -> status -> apply_alignment_result and acknowledges job', async () => {
    const registry = createToolRegistry();
    const mock = createAlignmentServerMock();

    const models = (await registry.call('list_alignment_models', {}, { client: mock.client })) as {
      items: Array<{ id: string; status: string }>;
    };
    expect(models.items[0]).toMatchObject({ id: 'ja-mfa', status: 'ready' });

    const preview = (await registry.call(
      'preview_alignment',
      { project_id: 'p1', model_id: 'ja-mfa' },
      { client: mock.client },
    )) as { model_preview: string; emitting_count: number; revision: string };
    expect(preview).toMatchObject({ model_preview: 'preview-token-1', emitting_count: 2, revision: 'rev-1' });

    const started = (await registry.call(
      'start_alignment',
      {
        project_id: 'p1',
        model_preview: preview.model_preview,
        merge_short_gaps: true,
        gap_threshold_ms: 100,
      },
      { client: mock.client },
    )) as { job_id: string; status: string };
    expect(started).toMatchObject({ job_id: 'job-1', status: 'queued' });

    // Busy queue returns retryable busy conflict with active job details
    try {
      await registry.call(
        'start_alignment',
        { project_id: 'p1', model_id: 'ja-mfa' },
        { client: mock.client },
      );
      expect.unreachable('should fail busy');
    } catch (err) {
      expect(err).toBeInstanceOf(StudioHttpError);
      expect((err as StudioHttpError).body.code).toBe('job_slot_busy');
      expect((err as StudioHttpError).body.retryable).toBe(true);
    }

    mock.markJobSucceeded();
    const status = (await registry.call('get_job_status', { job_id: 'job-1' }, { client: mock.client })) as {
      status: string;
      result_available: boolean;
    };
    expect(status).toMatchObject({ status: 'succeeded', result_available: true });

    const applied = (await registry.call(
      'apply_alignment_result',
      { job_id: 'job-1' },
      { client: mock.client },
    )) as {
      changed: boolean;
      previous_revision: string;
      new_revision: string;
      acknowledged_state: string;
      merged_gaps: number;
    };
    expect(applied).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      acknowledged_state: 'applied',
      merged_gaps: 1,
    });
    expect(mock.acknowledgements).toEqual([{ jobId: 'job-1', state: 'applied' }]);

    const updatedDoc = mock.getCurrentDoc();
    expect(updatedDoc.lyrics.lines[0]).toMatchObject({ beginMs: 500, endMs: 1400 });
    expect(updatedDoc.lyrics.lines[0].words[0]).toMatchObject({ beginMs: 500, endMs: 1400 });
    expect(updatedDoc.acoustics.analysisId).toBe('vocal-1');
  });

  it('supports cancel_job and rejects stale binding revision on apply_alignment_result', async () => {
    const registry = createToolRegistry();
    const mock = createAlignmentServerMock();

    const started = (await registry.call(
      'start_alignment',
      { project_id: 'p1', model_id: 'ja-mfa' },
      { client: mock.client },
    )) as { job_id: string };

    const cancelled = (await registry.call(
      'cancel_job',
      { job_id: started.job_id },
      { client: mock.client },
    )) as { status: string };
    expect(cancelled.status).toBe('cancelled');

    const second = (await registry.call(
      'start_alignment',
      { project_id: 'p1', model_id: 'ja-mfa' },
      { client: mock.client },
    )) as { job_id: string };

    mock.markJobSucceeded();
    mock.advanceExternalRevision();

    await expect(
      registry.call('apply_alignment_result', { job_id: second.job_id }, { client: mock.client }),
    ).rejects.toMatchObject({
      status: 412,
      body: { code: 'revision_conflict', current_revision: 'rev-2' },
    });
    expect(mock.acknowledgements).toHaveLength(0);
  });

  it('recovers apply_alignment_result when document save succeeds but acknowledge fails before retry', async () => {
    const registry = createToolRegistry();
    const mock = createAlignmentServerMock();

    const started = (await registry.call(
      'start_alignment',
      { project_id: 'p1', model_id: 'ja-mfa' },
      { client: mock.client },
    )) as { job_id: string };

    mock.markJobSucceeded();
    mock.failNextAcknowledge();

    await expect(
      registry.call(
        'apply_alignment_result',
        { job_id: started.job_id, idempotency_key: 'idem-align-1' },
        { client: mock.client },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(mock.getPutCount()).toBe(1);
    expect(mock.acknowledgements).toHaveLength(0);

    // Retry with same idempotency_key and mismatched args rejects with 409.
    await expect(
      registry.call(
        'apply_alignment_result',
        { job_id: started.job_id, idempotency_key: 'idem-align-1', clear_unmatched: true },
        { client: mock.client },
      ),
    ).rejects.toMatchObject({ status: 409, body: { code: 'idempotency_mismatch' } });

    // Retry with identical args reuses saved mutation, completes acknowledge without 412, and replays on 3rd call.
    const retried = (await registry.call(
      'apply_alignment_result',
      { job_id: started.job_id, idempotency_key: 'idem-align-1' },
      { client: mock.client },
    )) as Record<string, unknown>;
    expect(retried).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      job_id: started.job_id,
      acknowledged_state: 'applied',
    });
    expect(mock.getPutCount()).toBe(1);
    expect(mock.acknowledgements).toEqual([{ jobId: started.job_id, state: 'applied' }]);

    const replayed = (await registry.call(
      'apply_alignment_result',
      { job_id: started.job_id, idempotency_key: 'idem-align-1' },
      { client: mock.client },
    )) as Record<string, unknown>;
    expect(replayed).toEqual(retried);
    expect(mock.getPutCount()).toBe(1);
    expect(mock.acknowledgements).toHaveLength(1);
  });
});
