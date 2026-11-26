import { Blob } from 'node:buffer';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { BrowserAsset } from './db';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('Blob', Blob); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const asset = (id: string): BrowserAsset => ({ schema_version: 'studio-asset-v1', id, filename: `${id}.wav`, content_type: 'audio/wav', size_bytes: 4, duration_ms: 1000, source_duration_ms: 1000, source_start_ms: 0, proxy_offset_ms: 0, asset_hash: id, status: 'ready', project_id: null, sample_rate: 48000, channels: 1, ephemeral: false });

it('creates once, saves atomically, rejects a stale tab and retries the same save operation', async () => {
  const { browserStore } = await import('./db');
  await browserStore.create('local', null, 'p1');
  await browserStore.create('retry', null, 'p1');
  expect(await browserStore.list()).toHaveLength(1);
  const original = await browserStore.document('p1');
  const results = await Promise.allSettled([
    browserStore.save('p1', original.document, original.revision, 'save-a', 1),
    browserStore.save('p1', original.document, original.revision, 'save-b', 1),
  ]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: { status: 412 } });
  expect(await browserStore.save('p1', original.document, original.revision, 'save-a', 1)).toMatchObject({ revision: 'local-r2' });
  expect((await browserStore.document('p1')).revision).toBe('local-r2');
});

it('binds and replaces audio with the snapshot, protects bound assets, then deletes all project records', async () => {
  const { browserStore, stageAudio } = await import('./db');
  await stageAudio(asset('a1'), new Blob(['wave']));
  await browserStore.create('audio', 'a1', 'p1');
  expect((await browserStore.audio('a1'))?.size).toBe(4);
  expect((await browserStore.storage('p1')).categories.source).toBe(4);
  expect(JSON.stringify(await browserStore.project('p1'))).not.toContain('blob');
  await expect(browserStore.discard('a1')).rejects.toMatchObject({ status: 409 });
  await stageAudio(asset('a2'), new Blob(['next']));
  await expect(browserStore.attach('p1', { upload_id: 'a2', revision: 'wrong', expected_asset_id: 'a1', operation_id: 'attach' })).rejects.toMatchObject({ status: 412 });
  expect((await browserStore.document('p1')).source_asset_id).toBe('a1');
  const payload = { upload_id: 'a2', revision: 'local-r1', expected_asset_id: 'a1', operation_id: 'attach' };
  expect(await browserStore.attach('p1', payload)).toMatchObject({ revision: 'local-r2', asset: { id: 'a2' } });
  expect(await browserStore.attach('p1', payload)).toMatchObject({ revision: 'local-r2' });
  expect(await browserStore.asset('a1')).toBeUndefined();
  await browserStore.delete('p1');
  expect(await browserStore.list()).toEqual([]);
  expect(await browserStore.asset('a2')).toBeUndefined();
  await expect(browserStore.document('p1')).rejects.toMatchObject({ status: 404 });
});

it('falls back only for audio quota failure, keeps documents durable and frees session audio on delete', async () => {
  const { browserStore, stageAudio } = await import('./db');
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'assets' && value.blob) throw new DOMException('Full', 'QuotaExceededError');
    return put.call(this, value, key);
  });
  await stageAudio(asset('temporary'), new Blob(['wave']));
  expect(await browserStore.asset('temporary')).toMatchObject({ ephemeral: true });
  expect((await browserStore.audio('temporary'))?.size).toBe(4);
  await browserStore.create('session', 'temporary', 'p1');
  expect((await browserStore.storage('p1')).categories.source).toBe(0);
  const envelope = await browserStore.document('p1');
  await browserStore.save('p1', envelope.document, envelope.revision, 'save', 1);
  await browserStore.delete('p1');
  expect(await browserStore.audio('temporary')).toBeUndefined();
});

it('aborts a cancelled creation without leaving a project or binding its staged audio', async () => {
  const { browserStore, stageAudio } = await import('./db');
  await stageAudio(asset('staged'), new Blob(['wave']));
  const controller = new AbortController(); controller.abort();
  await expect(browserStore.create('cancelled', 'staged', 'p1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(await browserStore.list()).toHaveLength(0);
  await browserStore.discard('staged');
  expect(await browserStore.asset('staged')).toBeUndefined();
});
