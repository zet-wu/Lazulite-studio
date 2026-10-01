import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proposeRuby, rubyGenerationCommand, rubySourceRows } from "../domain/ruby-generation";
import { useProjectDocument } from "./useProjectDocument";

const saveMock = vi.fn();
const recovery = {
  save: vi.fn().mockResolvedValue(undefined),
  readCheckpoint: vi.fn().mockResolvedValue(null),
  load: vi.fn().mockResolvedValue(null),
  clear: vi.fn().mockResolvedValue(undefined),
  discard: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../adapters/recovery", () => ({
  createRecoveryAdapter: () => recovery,
}));

const XML =
  '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">A</p></div></body></tt>';
const hook = () =>
  useProjectDocument(
    "p",
    XML,
    "r1",
    undefined,
    (xml: string, base: string, op: string, seq: number, etag?: string) =>
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
    expect(checkpoint?.[2].present.lines[0].words[0].text).toBe("A2");
    expect(checkpoint?.[3]).toBe("r2");
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
      version: 1,
      projectId: "p",
      documentIdentity: "p",
      savedAt: new Date().toISOString(),
      baseRevision: "old",
      state: checkpoint,
    });
    recovery.load.mockResolvedValue(checkpoint);
    await act(async () => {
      await result.current.restore();
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.conflict).toBe(true);
  });

  it("saves generated 注音 with its source tracks and reopens the same semantics", async () => {
    const source = readFileSync("../tests/fixtures/ttml/phase2-multitrack.ttml", "utf8");
    let savedXml = "";
    saveMock.mockImplementation(async (xml: string) => {
      savedXml = xml;
      return { revision: "r2", etag: '"r2"' };
    });
    const { result } = renderHook(() => useProjectDocument("p", source, "r1", undefined, saveMock));
    const before = result.current.document;
    const track = before.romanizationTracks[0];
    const content = track.contents[0];
    const rows = proposeRuby(rubySourceRows(before, track.id, [content.id]), "hiragana");
    const proposal = rubyGenerationCommand(before, before, rows, {}, new Set(), new Set());
    act(() => result.current.apply(proposal));
    expect(result.current.dirty).toBe(true);
    const generated = result.current.document;
    expect(generated.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(["ふ", "た", "り"]);
    expect(generated.romanizationTracks).toEqual(before.romanizationTracks);
    await act(async () => result.current.save());
    expect(result.current.dirty).toBe(false);
    const reopened = renderHook(() => useProjectDocument("p", savedXml, "r2", '"r2"', saveMock));
    expect(reopened.result.current.document.romanizationTracks).toEqual(generated.romanizationTracks);
    expect(reopened.result.current.document.lines[0].words[0].rubyUnits).toEqual(generated.lines[0].words[0].rubyUnits);
    expect(reopened.result.current.document.lines[0].beginMs).toBe(999);
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
