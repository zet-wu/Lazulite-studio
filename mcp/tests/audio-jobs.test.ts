import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry, createMcpServer } from '../src/mcp-server';
import { projectFixture } from './project-fixture';
import { StudioClient } from '../src/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpToolPayload } from '../src/tools/registry';

it('summarizes vocal results and distinguishes available audio from project selection', async () => {
  const doc = createProjectDocument(); doc.acoustics.analysisId = 'selected';
  const base = { source_asset_id: 'a', duration_ms: 1000, status: 'ready', audio_id: 'audio', audio_state: 'current' };
  const items = [
    { ...base, id: 'selected', model: { model: 'BS Karaoke', config: { device: 'cuda' }, configuration_yaml: 'large config' }, segments: [{ id: 's1' }, { id: 's2' }], created_at: '2026-11-23' },
    { ...base, id: 'available', model: 'htdemucs' },
    { ...base, id: 'missing', audio_state: 'missing', model: { name: 'Named model' }, segments: [] },
    { ...base, id: 'other', model_name: 'Explicit name', model: { model_name: 'Nested name' } },
  ];
  const f = projectFixture(doc, url => {
    expect(url.pathname).toBe('/api/v1/projects/p/vocals'); return Response.json({ items });
  }), registry = createToolRegistry();
  const expected = { items: [
    { ...base, id: 'selected', is_active_in_project: true, model_name: 'BS Karaoke', segment_count: 2, created_at: '2026-11-23' },
    { ...base, id: 'available', is_active_in_project: false, model_name: 'htdemucs', segment_count: 0 },
    { ...base, id: 'missing', audio_state: 'missing', is_active_in_project: false, model_name: 'Named model', segment_count: 0 },
    { ...base, id: 'other', is_active_in_project: false, model_name: 'Explicit name', segment_count: 0 },
  ] };
  expect(await registry.call('list_vocal_results', { project_id: 'p' }, f)).toEqual(expected);
  expect(await registry.call('list_vocal_results', { project_id: 'p', detail: 'summary' }, f)).toEqual(expected);
  expect(await registry.call('list_vocal_results', { project_id: 'p', detail: 'full' }, f)).toEqual({
    items: items.map(item => ({ ...item, is_active_in_project: item.id === 'selected' })),
  });
  expect(f.writes()).toBe(0);
});

it('passes CPU retry rejection details through the MCP transport', async () => {
  let calls = 0;
  const studio = new StudioClient({ baseUrl: 'http://localhost:15173', fetchImpl: async (input, init) => {
    calls++;
    expect(new URL(String(input)).pathname).toBe('/api/v1/jobs/j/retry-cpu');
    expect(JSON.parse(String(init?.body))).toEqual({ revision: 'r1' });
    return Response.json({ code: 'job_not_failed', message: 'Only failed jobs can retry on CPU', retryable: false,
      reason: 'job_not_failed', params: { kind: 'vocal', status: 'succeeded' } }, { status: 409 });
  } });
  const server = createMcpServer(studio), client = new Client({ name: 'retry-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const result = await client.callTool({ name: 'retry_job_cpu', arguments: { job_id: 'j', revision: 'r1' } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toMatchObject({ code: 'job_not_failed', retryable: false,
      details: { status: 409, reason: 'job_not_failed', params: { kind: 'vocal', status: 'succeeded' } } });
    expect(calls).toBe(1);
  } finally { await Promise.all([client.close(), server.close()]); }
});

it('reads acoustic segments/gaps and bounded energy from the selected analysis', async () => {
  const doc = createProjectDocument(); doc.acoustics = { analysisId: 'v', segments: [{ id: 's1', beginMs: 100, endMs: 500 }, { id: 's2', beginMs: 1200, endMs: 1500 }] };
  const f = projectFixture(doc, url => {
    if (url.pathname.endsWith('/energy')) { expect(url.searchParams.get('buckets')).toBe('100'); return Response.json({ start_ms: 0, step_ms: 20, values: [0,1] }); }
    return Response.json({ asset: { duration_ms: 2000, source_duration_ms: 2000 } });
  });
  expect(await createToolRegistry().call('get_acoustics', { project_id: 'p', include_energy: true }, f)).toMatchObject({ analysis_id: 'v', gap_count: 3, total_gap_ms: 1300, gaps: [{ begin_ms: 0, end_ms: 100 }, { begin_ms: 500, end_ms: 1200 }, { begin_ms: 1500, end_ms: 2000 }], energy: { values: [0,1] } }); expect(f.writes()).toBe(0);
});
it('returns audio blocks through the actual MCP SDK transport and clamps a line window', async () => {
  const doc = createProjectDocument(); doc.lyrics.lines = [{ ...createLine('line', 'l'), beginMs: 100, endMs: 800 }];
  const f = projectFixture(doc, url => {
    if (url.pathname.endsWith('/audio-excerpt')) { expect(url.searchParams.get('start_ms')).toBe('0'); expect(url.searchParams.get('end_ms')).toBe('1000'); expect(url.searchParams.get('vocal')).toBe('v'); return new Response('RIFFtest', { headers: { 'X-Actual-Start-Ms': '0', 'X-Actual-End-Ms': '1000' } }); }
    if (url.pathname.endsWith('/vocals')) return Response.json({ items: [{ id: 'v', source_asset_id: 'a', duration_ms: 1000, audio_state: 'current', status: 'ready' }] });
    return Response.json({ asset: { id: 'a', duration_ms: 1000, source_duration_ms: 1000 } });
  });
  const server = createMcpServer(f.client), client = new Client({ name: 'audio-test', version: '1' }), [a,b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b),client.connect(a)]);
  try {
    const result = await client.callTool({ name: 'get_audio_excerpt', arguments: { project_id: 'p', line_id: 'l' } });
    expect(result.isError).toBeFalsy(); const content = result.content as McpToolPayload['content'];
    expect(content[0]).toMatchObject({ type: 'text' }); expect(JSON.parse((content[0] as { text: string }).text)).toMatchObject({ source: 'vocal', actual_range_ms: [0,1000], sample_rate: 16000, channels: 1, bytes: 8 });
    expect(content[1]).toEqual({ type: 'audio', mimeType: 'audio/wav', data: Buffer.from('RIFFtest').toString('base64') });
  } finally { await Promise.all([client.close(),server.close()]); }
});
it('adapts job management calls with bound revision, idempotency and filtered history', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const job = { id: 'j', project_id: 'p', kind: 'vocal', status: 'succeeded', request: { bound_revision: 'r1', devices: { vocal: { actual: 'cpu' } }, reused_vocal: true }, result_available: true };
  const client = new StudioClient({ baseUrl: 'http://localhost:15173', fetchImpl: async (input,init) => { const url = new URL(String(input)); calls.push({ path: url.pathname, init }); if (url.pathname === '/api/v1/projects/p') return Response.json({ asset: { id: 'a' } }); if (url.pathname.endsWith('/jobs')) return Response.json({ items: [job,{ ...job, id: 'a',kind: 'alignment' }] }); if (url.pathname.endsWith('/vocals') || url.pathname.endsWith('/vocal-models')) return Response.json({ items: [] }); return Response.json(job); } });
  const registry = createToolRegistry();
  expect(await registry.call('list_jobs', { project_id: 'p', kind: 'vocal' }, { client })).toMatchObject({ items: [{ job_id: 'j', reused_vocal: true }] });
  await registry.call('start_vocal_separation', { project_id: 'p', force_separation: true, idempotency_key: 'separate' }, { client });
  expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ params: { asset_id: 'a', force_separation: true } });
  expect(new Headers(calls.at(-1)?.init?.headers).get('Idempotency-Key')).toBe('separate');
  await registry.call('retry_job_cpu', { job_id: 'j', revision: 'r1', idempotency_key: 'retry' }, { client });
  expect(calls.at(-1)?.path).toBe('/api/v1/jobs/j/retry-cpu'); expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ revision: 'r1' });
  await registry.call('acknowledge_job', { job_id: 'j', state: 'dismissed' }, { client }); expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ state: 'dismissed' });
});
