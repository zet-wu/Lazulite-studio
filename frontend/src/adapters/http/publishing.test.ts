import { afterEach, describe, expect, it, vi } from "vitest";
import { publishingApi } from "./publishing";

describe("publishing adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams packaged audio and decodes UTF-8 Content-Disposition filename", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename*=UTF-8''%E6%AD%8C.m4a",
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await publishingApi.download("p", {
      revision: "r1",
      asset_id: "a1",
      stpp_action: "add",
      target_track_id: null,
      lrc_kind: "none",
      lrc_text: null,
    });
    expect(result.filename).toBe("歌.m4a");
    expect(result.blob.size).toBe(3);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      stpp_action: "add",
      lrc_kind: "none",
      lrc_text: null,
    });
  });

  it("surfaces structured server errors on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: { code: "publish_failed", message: "至少需要选择一项写入内容" } },
          { status: 422 },
        ),
      ),
    );

    await expect(
      publishingApi.download("p", {
        revision: "r1",
        asset_id: "a1",
        stpp_action: "none",
        target_track_id: null,
        lrc_kind: "none",
        lrc_text: null,
      }),
    ).rejects.toMatchObject({ status: 422, message: "至少需要选择一项写入内容" });
  });
});
