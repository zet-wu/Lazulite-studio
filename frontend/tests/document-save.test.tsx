import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, studioS4 } from '../src/adapters/http/client';
import { createProjectDocument } from '../src/domain/project-document';
import { serializeProject } from '../src/adapters/project-codec';
import { useProjectDocument } from '../src/features/useProjectDocument';

const recovery = vi.hoisted(() => ({ save: vi.fn(async () => {}), clear: vi.fn(async () => {}), readCheckpoint: vi.fn(async () => null) }));
vi.mock('../src/adapters/recovery', () => ({ createRecoveryAdapter: () => recovery }));
vi.mock('../src/adapters/project-lifecycle', () => ({ listenProjectDeletion: () => () => {}, clearProjectLocalData: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const snapshot = () => serializeProject(createProjectDocument());

it('preserves HTTP diagnostics on the real save adapter', async () => {
  const body = { code: 'document_invalid', reason: 'segment_order', params: { object_id: 'segment-1' }, message: '片段结束必须晚于开始', request_id: 'req-1', retryable: false };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 422 })));
  await expect(studioS4.saveRichDocument('p', snapshot(), 'r0', 'op1', 1)).rejects.toMatchObject({ status: 422, body, message: body.message });
});

it('keeps a non-JSON HTTP failure distinguishable from a document rejection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway unavailable', { status: 503, headers: { 'X-Request-ID': 'gateway-1' } })));
  await expect(studioS4.saveRichDocument('p', snapshot(), 'r0', 'op1', 1)).rejects.toMatchObject({ status: 503, body: { code: 'http_error', request_id: 'gateway-1', retryable: true } });
});

it.each(['rejected', 'uncertain'] as const)('%s save retries use the correct snapshot and operation identity', async kind => {
  const save = vi.fn().mockRejectedValueOnce(kind === 'rejected'
    ? new ApiError(422, { code: 'document_invalid', message: '片段错误', request_id: 'r', retryable: false })
    : new TypeError('Failed to fetch')).mockResolvedValue({ revision: 'r1', etag: '"r1"' });
  const { result } = renderHook(() => useProjectDocument('p', snapshot(), 'r0', '"r0"', save));
  await act(async () => { result.current.apply({ type: 'set-metadata', key: 'title', values: ['first'] }); });
  await act(async () => { await result.current.save(); });
  expect(result.current.dirty).toBe(true);
  expect(recovery.clear).not.toHaveBeenCalled();
  await act(async () => { result.current.apply({ type: 'set-metadata', key: 'title', values: ['corrected'] }); });
  await act(async () => { await result.current.save(); });
  const [first, second] = save.mock.calls;
  if (kind === 'rejected') {
    expect(second[2]).not.toBe(first[2]);
    expect(second[0].lyrics.draftTtml).toContain('corrected');
    expect(result.current.dirty).toBe(false);
  } else {
    expect(second).toEqual(first);
    expect(result.current.dirty).toBe(true);
    await act(async () => { await result.current.save(); });
    const third = save.mock.calls[2];
    expect(third[2]).not.toBe(first[2]);
    expect(third[1]).toBe('r1');
    expect(third[0].lyrics.draftTtml).toContain('corrected');
    expect(result.current.dirty).toBe(false);
  }
});
