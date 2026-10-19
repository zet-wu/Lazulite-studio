import { createProjectDocument, type ProjectSnapshot } from '../domain/project-document';
import { serializeProject } from '../adapters/project-codec';
import { parseLyricTtml } from '../adapters/ttml/lyric-codec';
const snapshot = (xml: string) => serializeProject(createProjectDocument(parseLyricTtml(xml)));
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectDocument } from "./useProjectDocument";

const saveMock = vi.fn();
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
  });

  it("reuses a failed pending operation, and undo marks the document dirty", async () => {
    saveMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ revision: "r2", etag: '"r2"' });
    const { result } = renderHook(hook, { wrapper: StrictMode });
    act(() =>
      result.current.apply({
        type: "edit-word",
        lineId: "a",
        wordId: "a:word:0",
        text: "A1",
      }),
    );
    await act(async () => result.current.save());
    const first = saveMock.mock.calls[0];
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());
    expect(saveMock.mock.calls[1][2]).toBe(first[2]);
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(true);
  });

  it("restores an old-base checkpoint and pauses it as a conflict", async () => {
    const { result } = renderHook(hook, { wrapper: StrictMode });
    const checkpoint = result.current.state;
    recovery.readCheckpoint.mockResolvedValue({
      version: 10,
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
  expect(()=>result.current.apply({type:'set-metadata',key:'title',values:['late']})).toThrow(/无法编辑/);
  expect(()=>result.current.applyProject({type:'amll-setting',rule:'noChorus',enabled:true})).toThrow(/无法编辑/);
  expect(()=>result.current.undo()).toThrow(/无法编辑/);
  expect(()=>result.current.redo()).toThrow(/无法编辑/);
  await expect(result.current.restore()).rejects.toThrow(/无法恢复/);
  const updated=structuredClone(lock.source);updated.lyrics.metadata.title=['aligned'];
  act(()=>{lock.apply(updated);lock.release();});
  expect(result.current.state.past).toHaveLength(1);expect(result.current.editingLocked).toBe(false);
  expect(()=>lock.apply(updated)).toThrow(/失效/);
  act(()=>result.current.undo());expect(result.current.project).toBe(lock.source);
});
