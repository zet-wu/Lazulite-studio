import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { selectionToCodePointRange } from "./RubyPanel";
import { JobCandidatePanel } from "./JobCandidatePanel";
import { parseStudioTtml } from "../adapters/ttml";
import type { ReadingResult } from "../adapters/http/jobs";

describe("Ruby workflow", () => {
  it("converts UTF-16 textarea offsets to code-point ranges", () => {
    expect(selectionToCodePointRange("𝄞今日", 2, 4)).toEqual({
      baseStart: 1,
      baseEnd: 3,
      base: "今日",
    });
  });

  it("applies a reading proposal only when its revision is current", () => {
    const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line">今日宇宙</p></body></tt>');
    const result: ReadingResult = {
      kind: "reading",
      binding: { revision: "r1", asset_id: "asset" },
      proposals: [{ line_id: "line", proposal_id: "p1", base_start: 0, base_end: 2, base: "今日", reading: "きょう", source: "dictionary", needs_review: true }],
    };
    let command: unknown;
    const view = render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(next) => { command = next; }} />);
    fireEvent.click(screen.getByRole("button", { name: "应用本行读音" }));
    expect(command).toMatchObject({ type: "update-ruby", lineId: document.lines[0].id, ruby: [{ base: "今日", reading: "きょう", baseStart: 0, baseEnd: 2 }] });

    view.rerender(<JobCandidatePanel result={result} currentRevision="r2" currentAssetId="asset" dirty={false} document={document} onApply={() => undefined} />);
    expect(screen.getByRole("button", { name: "应用本行读音" })).toBeDisabled();
    expect(screen.getByText(/禁止应用/)).toBeInTheDocument();
  });
});
