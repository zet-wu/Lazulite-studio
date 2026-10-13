import { afterEach, describe, expect, it, vi } from "vitest";
import { publishingApi } from "./publishing";
describe("publishing adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps structured export errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schema_version: "studio-export-list-v1",
          items: [
            {
              id: "j",
              revision: "r",
              asset_id: "a",
              status: "failed",
              created_at: "2026-01-01T00:00:00Z",
              stale: false,
              report: null,
              download_url: null,
              error: { code: "mux_failed", message: "ffmpeg failed" },
            },
          ],
        }),
      ),
    );
    const result = await publishingApi.list("p");
    expect(result.items[0].error).toEqual({
      code: "mux_failed",
      message: "ffmpeg failed",
    });
  });

  it("expresses preserving lyric tags with an explicit null payload", async () => {
    const fetcher=vi.fn(async(_url: string, _options?: RequestInit)=>Response.json({id:'job'}));vi.stubGlobal('fetch',fetcher);
    await publishingApi.publish('p','r','a',{lrc_kind:'none',lrc_text:null,target_track_id:null});
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({lrc_kind:'none',lrc_text:null});
  });
});
