import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry, createMcpServer } from '../src/mcp-server';
import { projectFixture } from './project-fixture';
import { StudioClient } from '../src/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpToolPayload } from '../src/tools/registry';
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
