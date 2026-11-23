import { createProjectDocument, type ProjectSnapshot } from '../domain/project-document';
import { serializeProject } from '../adapters/project-codec';
import { parseLyricTtml } from '../adapters/ttml/lyric-codec';
const snapshot = (xml: string) => serializeProject(createProjectDocument(parseLyricTtml(xml)));
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectDocument } from "./useProjectDocument";

afterEach(cleanup);

const saveMock = vi.fn();
const loadMock = vi.fn();
const recovery = {
  save: vi.fn().mockResolvedValue(undefined),
  readCheckpoint: vi.fn().mockResolvedValue(null),
  clear: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../adapters/recovery", () => ({
  createRecoveryAdapter: () => recovery,
}));

const XML =
  '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">A</p></div></body></tt>';
const hook = () =>
  useProjectDocument(
    "p",
    snapshot(XML),
    "r1",
    undefined,
    (xml: ProjectSnapshot, base: string, op: string, seq: number, etag?: string) =>
      saveMock(xml, base, op, seq, etag),
    null,
    loadMock,
  );

describe("useProjectDocument save lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMock.mockReset();
  });

  it("keeps later edits dirty while an earlier save is pending, then uses a new base and operation", async () => {
    let resolve!: (value: { revision: string; etag: string }) => void;
    saveMock
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ revision: "r2", etag: '"r2"' })
      .mockResolvedValue({ revision: "r3", etag: '"r3"' });
    const { result } = renderHook(hook, { wrapper: StrictMode });
    act(() =>
      result.current.apply({
        type: "edit-word",
        lineId: "a",
        wordId: "a:word:0",
        text: "A1",
      }),
    );
    await act(async () => {
      void result.current.save();
    });
    act(() =>
      result.current.apply({
        type: "edit-word",
        lineId: "a",
        wordId: "a:word:0",
        text: "A2",
      }),
    );
    await act(async () => resolve({ revision: "r2", etag: '"r2"' }));
    expect(result.current.dirty).toBe(true);
    const checkpoint = recovery.save.mock.calls.at(-1);
    expect(checkpoint?.[1].lyrics.lines[0].words[0].text).toBe("A2");
    expect(checkpoint?.[2]).toBe("r2");
    await act(async () => result.current.save());
    expect(saveMock.mock.calls[1][1]).toBe("r2");
    expect(saveMock.mock.calls[1][2]).not.toBe(saveMock.mock.calls[0][2]);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(true);
  });

  it("restores an old-base checkpoint and pauses it as a conflict", async () => {
    const { result } = renderHook(hook, { wrapper: StrictMode });
    const checkpoint = result.current.state;
    recovery.readCheckpoint.mockResolvedValue({
      version: 11,
      sourceAssetId: null,
      projectId: "p",
      baseRevision: "old",
      project: checkpoint.present,
    });
    await act(async () => {
      await result.current.restore();
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.conflict).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  it("flushes pending checkpoint immediately on unmount before debounce expires", async () => {
    const { result, unmount } = renderHook(hook, { wrapper: StrictMode });
    act(() => {
      result.current.apply({
        type: "edit-word",
        lineId: "a",
        wordId: "a:word:0",
        text: "B1",
      });
    });
    act(() => {
      result.current.apply({
        type: "edit-word",
        lineId: "a",
        wordId: "a:word:0",
        text: "B2",
      });
    });
    act(() => {
      result.current.undo();
    });
    expect(recovery.save).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(recovery.save).toHaveBeenCalledTimes(1);
    const saved = recovery.save.mock.calls[0];
    expect(saved[0]).toBe("p");
    expect(saved[1].lyrics.lines[0].words[0].text).toBe("B1");
    expect(saved[2]).toBe("r1");
  });
});

it('packaging returns the captured revision while later edits remain dirty', async () => {
 let resolve!: (v:{revision:string})=>void;
 saveMock.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const {result}=renderHook(hook);
 act(()=>result.current.apply({type:'edit-word',lineId:'a',wordId:'a:word:0',text:'captured'}));
 let pending!:ReturnType<typeof result.current.saveForPackaging>;
 act(()=>{pending=result.current.saveForPackaging();});
 act(()=>result.current.apply({type:'edit-word',lineId:'a',wordId:'a:word:0',text:'newer'}));
 await act(async()=>{resolve({revision:'packaged'});await pending;});
 const saved=await pending;
 expect(saved?.revision).toBe('packaged'); expect(saved?.document.lines[0].words[0].text).toBe('captured');
 expect(result.current.document.lines[0].words[0].text).toBe('newer'); expect(result.current.dirty).toBe(true);
});

it('locks every project command and late callbacks until one atomic result is applied', async () => {
  saveMock.mockResolvedValue({revision:'r2'});
  const {result}=renderHook(hook);
  let lock!:ReturnType<typeof result.current.lockEditing>;
  act(()=>{lock=result.current.lockEditing();});
  expect(result.current.editingLocked).toBe(true);
  expect(()=>result.current.apply({type:'set-metadata',key:'title',values:['late']})).toThrow(/save.editingLocked/);
  expect(()=>result.current.applyProject({type:'amll-setting',rule:'noChorus',enabled:true})).toThrow(/save.editingLocked/);
  expect(()=>result.current.undo()).toThrow(/save.editingLocked/);
  expect(()=>result.current.redo()).toThrow(/save.editingLocked/);
  await expect(result.current.restore()).rejects.toThrow(/save.recoveryLocked/);
  const updated=structuredClone(lock.source);updated.lyrics.metadata.title=['aligned'];
  act(()=>{lock.apply(updated);lock.release();});
  expect(result.current.state.past).toHaveLength(1);expect(result.current.editingLocked).toBe(false);
  expect(()=>lock.apply(updated)).toThrow(/save.alignmentExpired/);
  act(()=>result.current.undo());expect(result.current.project).toBe(lock.source);
});

it('auto-syncs external revisions when clean, ignores self-committed revisions, and warns when dirty', async () => {
  const remoteXml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">External</p></div></body></tt>';
  loadMock.mockResolvedValue({
    revision: 'r2',
    etag: '"r2"',
    document: snapshot(remoteXml),
    source_asset_id: null,
  });
  const { result } = renderHook(hook);

  await act(async () => {
    await result.current.syncExternalRevision('r2');
  });
  expect(result.current.revision).toBe('r2');
  expect(result.current.document.lines[0].words[0].text).toBe('External');
  expect(result.current.syncNotice?.text).toMatchObject({ key: 'sync.externalApplied' });

  // Self-committed revision does not trigger remote refetch.
  saveMock.mockResolvedValueOnce({ revision: 'r3', etag: '"r3"' });
  act(() => {
    result.current.apply({ type: 'edit-word', lineId: 'a', wordId: 'a:word:0', text: 'LocalSaved' });
  });
  await act(async () => {
    await result.current.save();
  });
  loadMock.mockClear();
  await act(async () => {
    await result.current.syncExternalRevision('r3');
  });
  expect(loadMock).not.toHaveBeenCalled();

  // Dirty local state surfaces externalUpdate without discarding local edits.
  const newerXml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">ServerNewer</p></div></body></tt>';
  loadMock.mockResolvedValue({
    revision: 'r4',
    etag: '"r4"',
    document: snapshot(newerXml),
    source_asset_id: null,
  });
  act(() => {
    result.current.apply({ type: 'edit-word', lineId: 'a', wordId: 'a:word:0', text: 'UnsavedDraft' });
  });
  await act(async () => {
    await result.current.syncExternalRevision('r4');
  });
  expect(result.current.externalUpdate?.revision).toBe('r4');
  expect(result.current.document.lines[0].words[0].text).toBe('UnsavedDraft');

  act(() => {
    result.current.keepLocalDraft();
  });
  expect(result.current.externalUpdate).toBeNull();
  expect(result.current.document.lines[0].words[0].text).toBe('UnsavedDraft');

  await act(async () => {
    await result.current.reloadExternal();
  });
  expect(result.current.revision).toBe('r4');
  expect(result.current.dirty).toBe(false);
  expect(result.current.document.lines[0].words[0].text).toBe('ServerNewer');
});

it('queues and converges to a newer SSE revision received while an earlier sync fetch is in flight', async () => {
  loadMock.mockReset();
  saveMock.mockReset();
  type Envelope = { revision: string; etag: string; document: ProjectSnapshot; source_asset_id: string | null };
  let resolveR2!: (value: Envelope) => void;
  const r2Xml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">V2</p></div></body></tt>';
  const r3Xml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">V3</p></div></body></tt>';
  const r4Xml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">V4</p></div></body></tt>';
  const r5Xml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">V5</p></div></body></tt>';

  let resolveR4!: (value: Envelope) => void;
  loadMock
    .mockImplementationOnce(() => new Promise<Envelope>((resolve) => { resolveR2 = resolve; }))
    .mockResolvedValueOnce({ revision: 'r3', etag: '"r3"', document: snapshot(r3Xml), source_asset_id: null })
    .mockImplementationOnce(() => new Promise<Envelope>((resolve) => { resolveR4 = resolve; }))
    .mockResolvedValueOnce({ revision: 'r5', etag: '"r5"', document: snapshot(r5Xml), source_asset_id: null });

  const { result } = renderHook(hook);

  // Clean state: r2 fetch starts, r3 arrives before r2 resolves -> converges to r3
  let syncPromise!: Promise<void>;
  act(() => {
    syncPromise = result.current.syncExternalRevision('r2');
  });
  await act(async () => {
    await result.current.syncExternalRevision('r3');
  });
  await act(async () => {
    resolveR2({ revision: 'r2', etag: '"r2"', document: snapshot(r2Xml), source_asset_id: null });
    await syncPromise;
    await Promise.resolve();
  });

  expect(loadMock).toHaveBeenCalledTimes(2);
  expect(result.current.revision).toBe('r3');
  expect(result.current.document.lines[0].words[0].text).toBe('V3');

  // Dirty state: r4 fetch starts, r5 arrives before r4 resolves -> externalUpdate converges to r5 while keeping local draft
  act(() => {
    result.current.apply({ type: 'edit-word', lineId: 'a', wordId: 'a:word:0', text: 'LocalDraft' });
  });
  let dirtySync!: Promise<void>;
  act(() => {
    dirtySync = result.current.syncExternalRevision('r4');
  });
  await act(async () => {
    await result.current.syncExternalRevision('r5');
  });
  await act(async () => {
    resolveR4({ revision: 'r4', etag: '"r4"', document: snapshot(r4Xml), source_asset_id: null });
    await dirtySync;
    await Promise.resolve();
  });

  expect(loadMock).toHaveBeenCalledTimes(4);
  expect(result.current.externalUpdate?.revision).toBe('r5');
  expect(result.current.document.lines[0].words[0].text).toBe('LocalDraft');
});
