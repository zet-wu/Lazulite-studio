import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStudioTtml } from "../adapters/ttml";
import { createEditorState, executeCommand } from "../domain/editing";
import { TimingPanel } from "./TimingPanel";

function lineFixture() {
  const document = parseStudioTtml(
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line" begin="0s" end="2s">今日</p></body></tt>',
  );
  document.lines[0].ruby = [
    { id: "ruby-1", base: "今日", reading: "きょう", baseStart: 0, baseEnd: 2 },
  ];
  return document.lines[0];
}
function select(textarea: HTMLTextAreaElement, start: number, end: number) {
  Object.defineProperty(textarea, "selectionStart", {
    configurable: true,
    value: start,
  });
  Object.defineProperty(textarea, "selectionEnd", {
    configurable: true,
    value: end,
  });
  fireEvent.select(textarea);
}

describe("TimingPanel", () => {
  afterEach(() => cleanup());
  it("creates text and reading units with correct Ruby binding", () => {
    const line = lineFixture();
    let current = line.timingUnits;
    const onChange = vi.fn((next) => {
      current = next;
      return true;
    });
    const view = render(
      <TimingPanel
        line={{ ...line, timingUnits: current }}
        onChange={onChange}
      />,
    );
    const text = screen.getByRole("textbox", {
      name: "选择正文范围",
    }) as HTMLTextAreaElement;
    select(text, 0, 2);
    fireEvent.click(screen.getByRole("button", { name: "建立时间单元" }));
    expect(onChange).toHaveBeenCalled();
    expect(current[0]).toMatchObject({
      textStart: 0,
      textEnd: 2,
      rubyId: null,
      readingStart: null,
      readingEnd: null,
    });
    view.rerender(
      <TimingPanel line={{ ...line, timingUnits: [] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("读音"));
    const reading = screen.getByRole("textbox", {
      name: "选择读音范围",
    }) as HTMLTextAreaElement;
    select(reading, 0, 3);
    fireEvent.click(screen.getByRole("button", { name: "建立时间单元" }));
    expect(current.at(-1)).toMatchObject({
      rubyId: "ruby-1",
      textStart: 0,
      textEnd: 2,
      readingStart: 0,
      readingEnd: 3,
    });
  });

  it("keeps null time empty, syncs external undo, and rolls back failed commits", () => {
    const line = lineFixture();
    const first = {
      ...line,
      timingUnits: [
        {
          id: "u",
          kind: "word" as const,
          textStart: 0,
          textEnd: 1,
          readingStart: null,
          readingEnd: null,
          rubyId: null,
          beginUs: null,
          endUs: null,
        },
      ],
    };
    const onChange = vi.fn(() => false);
    const view = render(<TimingPanel line={first} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "开始时间（秒）" })).toHaveValue(
      "",
    );
    const begin = screen.getByRole("textbox", { name: "开始时间（秒）" });
    fireEvent.change(begin, { target: { value: "0.5" } });
    fireEvent.blur(begin);
    expect(begin).toHaveValue("");
    const undo = { ...line, timingUnits: [] };
    view.rerender(<TimingPanel line={undo} onChange={onChange} />);
    expect(screen.getByText(/暂无时间单元/)).toBeInTheDocument();
  });

  it("splits and merges a Ruby reading at the selected reading cursor", () => {
    const line = lineFixture();
    const unit = {
      id: "u",
      kind: "word" as const,
      textStart: 0,
      textEnd: 2,
      readingStart: 0,
      readingEnd: 3,
      rubyId: "ruby-1",
      beginUs: 0,
      endUs: 2_000_000,
    };
    const document = { ...line, timingUnits: [unit] };
    let state = createEditorState({
      ...parseStudioTtml(
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line">今日</p></body></tt>',
      ),
      lines: [document],
    });
    const onChange = (
      next: (typeof state.present.document.lines)[0]["timingUnits"],
    ) => {
      state = executeCommand(state, {
        type: "update-timing-units",
        lineId: line.id,
        units: next,
      });
      return true;
    };
    const view = render(<TimingPanel line={document} onChange={onChange} />);
    const split = screen.getByRole("textbox", { name: "拆分边界" });
    Object.defineProperty(split, "selectionStart", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(split, "selectionEnd", {
      configurable: true,
      value: 1,
    });
    fireEvent.select(split);
    fireEvent.click(screen.getByRole("button", { name: "拆分" }));
    expect(
      state.present.document.lines[0].timingUnits.map((item) => [
        item.textStart,
        item.textEnd,
        item.readingStart,
        item.readingEnd,
      ]),
    ).toEqual([
      [0, 2, 0, 1],
      [0, 2, 1, 3],
    ]);
    view.rerender(
      <TimingPanel
        line={{
          ...document,
          timingUnits: state.present.document.lines[0].timingUnits,
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "合并相邻单元" })[0]);
    expect(state.present.document.lines[0].timingUnits).toHaveLength(1);
  });
});
