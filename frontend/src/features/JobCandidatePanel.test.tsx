import { fireEvent, render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { parseStudioTtml } from "../adapters/ttml";
import { JobCandidatePanel } from "./JobCandidatePanel";
import type { AlignResult } from "../adapters/http/jobs";

it("maps xml id, keeps null timing and skips read-only lines", () => {
  const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="plain" begin="0s" end="1s">A</p><p xml:id="locked" begin="1s" end="2s"><span> B </span></p></body></tt>');
  const result: AlignResult = { kind: "line_align", binding: { revision: "r1", asset_id: "a1" }, lines: [{ line_id: "plain", begin_us: null, end_us: 1500000, score: null, issues: ["interpolated"] }, { line_id: "locked", begin_us: 2_000_000, end_us: 3_000_000, score: 0.5, issues: [] }] };
  let command: unknown;
  render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="a1" dirty={false} document={document} onApply={(value) => { command = value; }} />);
  fireEvent.click(screen.getByRole("button", { name: "人工应用候选" }));
  expect(command).toEqual({ type: "update-lines", updates: [{ lineId: expect.any(String), changes: { beginUs: null, endUs: 1500000 } }] });
  expect(screen.getByText(/时间字段只读/)).toBeInTheDocument();
});
