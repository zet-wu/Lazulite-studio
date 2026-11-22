import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as amll from '../domain/amll-compatibility';
import { createLine, createLyricDocument } from '../domain/lyric-document';
import { useAutomaticValidation } from './useAutomaticValidation';

afterEach(() => vi.restoreAllMocks());

it('checks only committed documents, coalesces changes and cancels stale checks', async () => {
  const check = vi.spyOn(amll, 'checkAmll');
  const initial = { doc: { ...createLyricDocument(), lines: [createLine('initial')] }, id: 'p' };
  const { result, rerender, unmount } = renderHook((p) => useAutomaticValidation(p.doc, p.id), { initialProps: initial });
  await waitFor(() => expect(result.current.current).toBe(true));
  expect(check).toHaveBeenCalledTimes(1);
  expect(result.current.result?.amll).toBeDefined();

  rerender({ ...initial });
  expect(check).toHaveBeenCalledTimes(1);

  const next = { doc: { ...initial.doc, lines: [createLine('next')] }, id: 'p2' };
  rerender(next);
  expect(result.current.current).toBe(false);
  await waitFor(() => expect(result.current.current).toBe(true));
  expect(check).toHaveBeenCalledTimes(2);
  expect(result.current.result?.projectId).toBe('p2');

  rerender({ doc: createLyricDocument(), id: 'p2' });
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check).toHaveBeenCalledTimes(2);
});

it('reports execution failures instead of a successful empty report', async () => {
  vi.spyOn(amll, 'checkAmll').mockImplementation(() => { throw new Error('计算失败样例'); });
  const doc = { ...createLyricDocument(), lines: [createLine('test')] };
  const { result } = renderHook(() => useAutomaticValidation(doc, 'p'));
  await waitFor(() => expect(result.current.current).toBe(true));
  expect(result.current.result?.error).toEqual({ key: 'error.unexpected', values: { diagnostic: '计算失败样例' } });
  expect(result.current.result?.amll).toBeUndefined();
});
