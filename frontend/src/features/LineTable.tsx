import { useEffect, useRef, useState } from "react";
import type { StudioAgent, StudioLine } from "../domain/document";
import styles from "./workspace.module.css";

const ROW_HEIGHT = 46;
const OVERSCAN = 6;
const clock = (v: number | null) =>
  v == null
    ? "--:--.---"
    : `${String(Math.floor(v / 60000000)).padStart(2, "0")}:${String(Math.floor(v / 1000000) % 60).padStart(2, "0")}.${String(Math.floor(v / 1000) % 1000).padStart(3, "0")}`;

type Props = {
  lines: StudioLine[];
  selected: number;
  onSelect: (index: number) => void;
  onEdit: (
    id: string,
    changes: Partial<Pick<StudioLine, "text" | "agentRefs">>,
  ) => void;
  agents: StudioAgent[];
  visible: boolean;
};
export function LineTable({
  lines,
  selected,
  onSelect,
  onEdit,
  agents,
  visible,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  const maxScrollTop = Math.max(0, lines.length * ROW_HEIGHT - height);
  const boundedScrollTop = Math.min(scrollTop, maxScrollTop);
  const first = Math.max(0, Math.floor(boundedScrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.min(
    lines.length - first,
    Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2,
  );
  const last = Math.max(first, first + count);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (scrollTop > maxScrollTop) {
      scrollRef.current?.scrollTo({ top: maxScrollTop });
      setScrollTop(maxScrollTop);
    }
  }, [maxScrollTop, scrollTop]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selected < 0 || selected >= lines.length) return;
    const rowTop = selected * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const viewportTop = element.scrollTop;
    const viewportBottom = viewportTop + height;
    if (rowTop < viewportTop || rowBottom > viewportBottom) {
      element.scrollTo({ top: Math.max(0, rowTop - height / 2) });
      setPendingFocus(selected);
    }
  }, [height, lines.length, selected]);
  useEffect(() => {
    if (pendingFocus == null || pendingFocus < first || pendingFocus >= last) return;
    rowRefs.current[pendingFocus]?.focus();
    setPendingFocus(null);
  }, [first, last, pendingFocus]);
  const move = (index: number) => {
    onSelect(index);
    scrollRef.current?.scrollTo({
      top: Math.max(0, index * ROW_HEIGHT - height / 2),
    });
    setPendingFocus(index);
  };
  return (
    <main
      className={`${styles.editor} ${visible ? styles.mobileVisible : styles.mobileHidden}`}
    >
      <div className={styles.editorHeader}>
        <h1>歌词行表</h1>
        <span>{lines.length} 行</span>
      </div>
      <div
        ref={scrollRef}
        className={styles.lineTable}
        role="listbox"
        aria-label="歌词行表"
        aria-setsize={lines.length}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: first * ROW_HEIGHT }} aria-hidden="true" />
        <div>
          {lines.slice(first, last).map((item, offset) => {
            const index = first + offset;
            return (
              <div
                key={item.id}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                role="option"
                aria-selected={index === selected}
                aria-posinset={index + 1}
                tabIndex={index === selected ? 0 : -1}
                className={`${styles.lineRow} ${index === selected ? styles.lineSelected : ""}`}
                style={{ height: ROW_HEIGHT, boxSizing: "border-box" }}
                onClick={() => onSelect(index)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    move(Math.min(lines.length - 1, index + 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    move(Math.max(0, index - 1));
                  }
                }}
              >
                <span className={styles.lineIndex}>{index + 1}</span>
                <span className={styles.lineTime}>{clock(item.beginUs)}</span>
                <EditableLineText line={item} onEdit={onEdit} />
                <select
                  aria-label={`第${index + 1}行歌手`}
                  value={item.agentRefs[0] ?? ""}
                  onChange={(event) =>
                    onEdit(item.id, {
                      agentRefs: event.target.value ? [event.target.value] : [],
                    })
                  }
                >
                  <option value="">未分配</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name ?? "未命名"}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div
          style={{ height: Math.max(0, (lines.length - last) * ROW_HEIGHT) }}
          aria-hidden="true"
        />
      </div>
    </main>
  );
}
function EditableLineText({
  line,
  onEdit,
}: {
  line: StudioLine;
  onEdit: Props["onEdit"];
}) {
  const [value, setValue] = useState(line.text);
  const composing = useRef(false);
  useEffect(() => setValue(line.text), [line.id, line.text]);
  const commit = (nextValue = value) => {
    if (nextValue !== line.text) onEdit(line.id, { text: nextValue });
  };
  return (
    <input
      className={styles.inlineInput}
      value={value}
      disabled={!line.editable.text}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        const nextValue = event.currentTarget.value;
        setValue(nextValue);
        commit(nextValue);
      }}
      onChange={(event) => {
        setValue(event.target.value);
        if (!composing.current) onEdit(line.id, { text: event.target.value });
      }}
      onBlur={() => commit()}
    />
  );
}
