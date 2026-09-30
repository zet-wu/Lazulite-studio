import { afterEach, describe, expect, it, vi } from "vitest";
import { publishingApi } from "./publishing";
import { parseLyricTtml } from "../ttml/lyric-codec";
import { validatePublishDocument as validate } from "../publish-validation";
const validatePublishDocument = (xml: string) => validate(parseLyricTtml(xml));

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

  it("rejects invalid TTML before a publish request can be made", () => {
    expect(() =>
      validatePublishDocument(
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>missing timing</p></div></body></tt>',
      ),
    ).toThrow();
  });
});
