import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, it, expect } from "vitest";
import { parseStudioTtml } from "../adapters/ttml";
import { createEditorState, executeCommand } from "../domain/editing";
import { JobCandidatePanel } from "./JobCandidatePanel";
import type { AlignResult, ForcedAlignResult } from "../adapters/http/jobs";

afterEach(() => cleanup());

it("maps xml id, keeps null timing and skips read-only lines", () => {
  const document = parseStudioTtml(
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="plain" begin="0s" end="1s">A</p><p xml:id="locked" begin="1s" end="2s"><span xmlns="urn:unknown:studio"> B </span></p></body></tt>',
  );
  const result: AlignResult = {
    kind: "line_align",
    binding: { revision: "r1", asset_id: "a1" },
    lines: [
      {
        line_id: "plain",
        begin_us: null,
        end_us: 1500000,
        score: null,
        issues: ["interpolated"],
      },
      {
        line_id: "locked",
        begin_us: 2_000_000,
        end_us: 3_000_000,
        score: 0.5,
        issues: [],
      },
    ],
  };
  let command: unknown;
  render(
    <JobCandidatePanel
      result={result}
      currentRevision="r1"
      currentAssetId="a1"
      dirty={false}
      document={document}
      onApply={(value) => {
        command = value;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "人工应用候选" }));
  expect(command).toEqual({
    type: "update-lines",
    updates: [
      {
        lineId: expect.any(String),
        changes: { beginUs: null, endUs: 1500000 },
      },
    ],
  });
  expect(screen.getByText(/时间字段只读/)).toBeInTheDocument();
});

it("maps forced Ruby coordinates and rejects stale results", () => {
  const document = parseStudioTtml(
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="line"><span studio:id="body-unit" studio:kind="word" begin="0s" end="0.1s">歌</span><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text"><span studio:id="first-ruby-unit" studio:kind="word" begin="0.1s" end="0.2s">きょう</span></span></span> <span tts:ruby="container"><span tts:ruby="base">宇宙</span><span tts:ruby="text"><span studio:id="other-ruby-unit" studio:kind="word" begin="0.2s" end="0.3s">うちゅう</span></span></span></p></body></tt>',
  );
  const line = document.lines[0];
  const [firstRuby, otherRuby] = line.ruby;
  const bodyUnit = line.timingUnits.find((unit) => unit.rubyId === null)!;
  const otherRubyUnit = line.timingUnits.find(
    (unit) => unit.rubyId === otherRuby.id,
  )!;
  const firstRubyUnit = line.timingUnits.find(
    (unit) => unit.rubyId === firstRuby.id,
  )!;
  const result: ForcedAlignResult = {
    kind: "forced_align",
    binding: { revision: "r1", asset_id: "a1" },
    units: [
      {
        line_id: "line",
        input_range: [0, 2],
        source_range: [firstRuby.baseStart, firstRuby.baseEnd],
        text: "きょう",
        start_us: 100,
        end_us: 500,
        granularity: "word",
        confidence: 0.9,
        ruby_id: firstRuby.id,
      },
    ],
  };
  let applied = createEditorState(document);
  const view = render(
    <JobCandidatePanel
      result={{
        ...result,
        evidence: {
          request: {
            coordinate_space: "ruby",
            ruby_id: firstRuby.id,
            source_range: [firstRuby.baseStart, firstRuby.baseEnd],
          },
        },
      }}
      currentRevision="r1"
      currentAssetId="a1"
      dirty={false}
      document={document}
      onApply={(next) => {
        applied = executeCommand(applied, next);
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "人工应用候选" }));
  const updatedUnits = applied.present.document.lines[0].timingUnits;
  expect(
    updatedUnits.find((unit) => unit.rubyId === firstRuby.id),
  ).toMatchObject({
    rubyId: firstRuby.id,
    textStart: firstRuby.baseStart,
    textEnd: firstRuby.baseEnd,
    readingStart: 0,
    readingEnd: 2,
  });
  expect(updatedUnits.map((unit) => unit.id)).toEqual(
    expect.arrayContaining([bodyUnit.id, otherRubyUnit.id]),
  );
  expect(updatedUnits.map((unit) => unit.id)).not.toContain(firstRubyUnit.id);
  view.rerender(
    <JobCandidatePanel
      result={result}
      currentRevision="r2"
      currentAssetId="a1"
      dirty={false}
      document={document}
      onApply={() => undefined}
    />,
  );
  expect(screen.getByRole("button", { name: "人工应用候选" })).toBeDisabled();
});
