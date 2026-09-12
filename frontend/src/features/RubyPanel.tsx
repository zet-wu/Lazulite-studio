import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioLine, StudioRuby } from "../domain/document";
import styles from "./ruby-panel.module.css";

export type CodePointSelection = {
  baseStart: number;
  baseEnd: number;
  base: string;
};

/** Convert native UTF-16 textarea offsets into the document's code-point range. */
export function selectionToCodePointRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): CodePointSelection | null {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(start, Math.max(selectionStart, selectionEnd));
  const points = Array.from(text);
  const baseStart = Array.from(text.slice(0, start)).length;
  const baseEnd = Array.from(text.slice(0, end)).length;
  if (baseStart === baseEnd) return null;
  return { baseStart, baseEnd, base: points.slice(baseStart, baseEnd).join("") };
}

type Props = {
  line: StudioLine;
  onApply: (ruby: StudioRuby[]) => void;
};

const stableRubyId = (lineId: string, baseStart: number, baseEnd: number) =>
  `${lineId}-ruby-${baseStart}-${baseEnd}`;

export function RubyPanel({ line, onApply }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [reading, setReading] = useState("");
  const [selection, setSelection] = useState<CodePointSelection | null>(null);
  const [message, setMessage] = useState("");
  const editable = line.editable.text;
  useEffect(() => {
    setReading("");
    setSelection(null);
    setMessage("");
  }, [line.id, line.text]);
  const existingRanges = useMemo(
    () => new Map(line.ruby.map((span) => [`${span.baseStart}:${span.baseEnd}`, span])),
    [line.ruby],
  );

  const readSelection = () => {
    const input = textarea.current;
    if (!input) return;
    setSelection(
      selectionToCodePointRange(line.text, input.selectionStart, input.selectionEnd),
    );
  };
  const add = () => {
    if (!editable) return;
    if (!selection || !reading.trim()) {
      setMessage("先高亮一段正文并填写整体读音");
      return;
    }
    const overlap = line.ruby.find(
      (span) =>
        span.baseStart < selection.baseEnd && selection.baseStart < span.baseEnd &&
        !(span.baseStart === selection.baseStart && span.baseEnd === selection.baseEnd),
    );
    if (overlap) {
      setMessage(`范围与已有「${overlap.base}」重叠，请先处理已有注音`);
      return;
    }
    const key = `${selection.baseStart}:${selection.baseEnd}`;
    const previous = existingRanges.get(key);
    const next: StudioRuby = {
      id: previous?.id ?? stableRubyId(line.id, selection.baseStart, selection.baseEnd),
      base: selection.base,
      reading: reading.trim(),
      baseStart: selection.baseStart,
      baseEnd: selection.baseEnd,
    };
    onApply([...line.ruby.filter((span) => span.id !== previous?.id), next].sort((a, b) => a.baseStart - b.baseStart));
    setReading("");
    setSelection(null);
    setMessage("已加入注音，保存后请在审核面板确认");
  };
  const update = (span: StudioRuby, nextReading: string) => {
    if (!nextReading.trim()) {
      setMessage("读音不能为空");
      return;
    }
    onApply(line.ruby.map((item) => item.id === span.id ? { ...item, reading: nextReading.trim() } : item));
    setMessage("注音已修改，保存后请重新确认");
  };
  const remove = (span: StudioRuby) => {
    onApply(line.ruby.filter((item) => item.id !== span.id));
    setMessage("注音已删除，保存后请重新确认");
  };

  return (
    <section className={styles.panel} aria-label="注音编辑">
      <p className={styles.note}>整体读音使用正文 code point 范围；确认读音请在保存后使用审核面板。</p>
      {!editable && (
        <p className={styles.readonly}>
          该行注音只读：{line.locks.text ?? "包含无法安全编辑的复杂内联结构"}。
        </p>
      )}
      <label className={styles.label}>
        选中正文
        <textarea
          ref={textarea}
          className={styles.selection}
          value={line.text}
          readOnly
          aria-label="选中正文"
          onSelect={readSelection}
          onMouseUp={readSelection}
          onKeyUp={readSelection}
        />
      </label>
      {editable && (
        <div className={styles.addRow}>
          <input
            value={reading}
            onChange={(event) => setReading(event.target.value)}
            placeholder="整体读音"
            aria-label="整体读音"
          />
          <button onClick={add}>添加</button>
        </div>
      )}
      {selection && <p className={styles.range}>范围 {selection.baseStart}–{selection.baseEnd} · {selection.base}</p>}
      {line.ruby.length === 0 ? (
        <p className={styles.note}>暂无注音</p>
      ) : (
        <div className={styles.rubyList}>
          {line.ruby.map((span) => (
            <RubyRow key={span.id} span={span} editable={editable} changed={line.baseline.ruby.every((base) => base.id !== span.id) || line.baseline.ruby.some((base) => base.id === span.id && base.reading !== span.reading)} onUpdate={update} onRemove={remove} />
          ))}
        </div>
      )}
      {message && <p className={styles.message} role="status">{message}</p>}
    </section>
  );
}

function RubyRow({
  span,
  editable,
  changed,
  onUpdate,
  onRemove,
}: {
  span: StudioRuby;
  editable: boolean;
  changed: boolean;
  onUpdate: (span: StudioRuby, reading: string) => void;
  onRemove: (span: StudioRuby) => void;
}) {
  const [value, setValue] = useState(span.reading);
  useEffect(() => setValue(span.reading), [span.id, span.reading]);
  return (
    <article className={styles.rubyRow}>
      <ruby className={styles.preview}>{span.base}<rt>{span.reading}</rt></ruby>
      <input className={styles.baseInput} value={span.base} readOnly aria-label={`${span.base} 的正文`} />
      <input
        value={value}
        disabled={!editable}
        aria-label={`${span.base} 的读音`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => value !== span.reading && onUpdate(span, value)}
      />
      <span className={styles.meta}>base {span.baseStart}–{span.baseEnd}</span>
      <span className={styles.status}>{changed ? "已编辑，保存后需重新确认" : "待确认由审核面板处理"}</span>
      {editable && <button onClick={() => onRemove(span)}>删除</button>}
    </article>
  );
}
