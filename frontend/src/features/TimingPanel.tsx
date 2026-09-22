import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type {
  StudioLine,
  TimingUnit,
  TimingUnitKind,
} from "../domain/document";
import styles from "./timing-panel.module.css";

const kinds: Array<[TimingUnitKind, string]> = [
  ["word", "词"],
  ["mora", "音拍"],
  ["phoneme", "音素"],
];
const chars = (value: string) => Array.from(value);
export function selectionToCodePointRange(
  value: string,
  start: number,
  end: number,
) {
  const left = Math.min(start, end);
  const right = Math.max(start, end);
  const baseStart = chars(value.slice(0, left)).length;
  const baseEnd = chars(value.slice(0, right)).length;
  return baseStart < baseEnd ? { baseStart, baseEnd } : null;
}
type Props = {
  line: StudioLine;
  onChange: (units: TimingUnit[]) => boolean;
  onSelect?: (id: string) => void;
};
export function TimingPanel({ line, onChange, onSelect }: Props) {
  const [mode, setMode] = useState<"text" | "reading">("text");
  const [kind, setKind] = useState<TimingUnitKind>(
    line.timingUnits[0]?.kind ?? "word",
  );
  const [units, setUnits] = useState(line.timingUnits);
  const unitsRef = useRef(units);
  const [selected, setSelected] = useState<string | null>(
    line.timingUnits[0]?.id ?? null,
  );
  const [rubyId, setRubyId] = useState(line.ruby[0]?.id ?? "");
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  useEffect(() => {
    const next = line.ruby[0]?.id ?? "";
    setRubyId((current) =>
      line.ruby.some((item) => item.id === current) ? current : next,
    );
    setRange(null);
  }, [line.id, line.ruby]);
  useEffect(() => {
    if (JSON.stringify(unitsRef.current) !== JSON.stringify(line.timingUnits)) {
      setUnits(line.timingUnits);
      unitsRef.current = line.timingUnits;
      setSelected((current) =>
        line.timingUnits.some((item) => item.id === current)
          ? current
          : (line.timingUnits[0]?.id ?? null),
      );
    }
  }, [line.id, line.timingUnits]);
  const commit = (next: TimingUnit[]) => {
    if (!onChange(next)) return false;
    unitsRef.current = next;
    setUnits(next);
    return true;
  };
  const reading = line.ruby.find((item) => item.id === rubyId);
  const source = mode === "text" ? line.text : (reading?.reading ?? "");
  const updateSelection = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    if (mode !== "text" && !reading) return;
    const input = event.currentTarget;
    const next = selectionToCodePointRange(
      source,
      input.selectionStart,
      input.selectionEnd,
    );
    setRange(next && { start: next.baseStart, end: next.baseEnd });
  };
  const create = () => {
    if (!range) return;
    const textStart = mode === "text" ? range.start : (reading?.baseStart ?? 0);
    const textEnd = mode === "text" ? range.end : (reading?.baseEnd ?? 0);
    if (textStart >= textEnd) return;
    const unit: TimingUnit = {
      id: `${line.id}-unit-${Date.now()}`,
      kind,
      textStart,
      textEnd,
      readingStart: mode === "reading" ? range.start : null,
      readingEnd: mode === "reading" ? range.end : null,
      rubyId: mode === "reading" ? (reading?.id ?? null) : null,
      beginUs: line.beginUs,
      endUs: line.endUs,
    };
    if (commit([...units, unit])) {
      setSelected(unit.id);
      onSelect?.(unit.id);
      setRange(null);
    }
  };
  return (
    <section className={styles.panel} aria-label="时间编辑">
      <div className={styles.switch} role="tablist">
        <button
          className={mode === "text" ? styles.active : ""}
          onClick={() => {
            setMode("text");
            setRange(null);
          }}
        >
          正文
        </button>
        <button
          className={mode === "reading" ? styles.active : ""}
          onClick={() => {
            setMode("reading");
            setRange(null);
          }}
        >
          读音
        </button>
      </div>
      {mode === "reading" && (
        <label className={styles.rubySelect}>
          注音范围
          <select
            aria-label="选择注音"
            value={rubyId}
            onChange={(event) => {
              setRubyId(event.target.value);
              setRange(null);
            }}
          >
            {line.ruby.map((item) => (
              <option key={item.id} value={item.id}>
                {item.base} · {item.reading}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.rubySelect}>
        单位
        <select
          aria-label="时间单位"
          value={kind}
          onChange={(event) => setKind(event.target.value as TimingUnitKind)}
        >
          {kinds.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.selectionRow}>
        <textarea
          aria-label={mode === "text" ? "选择正文范围" : "选择读音范围"}
          value={source}
          readOnly
          onSelect={updateSelection}
          onKeyUp={updateSelection}
        />
        <button
          onClick={create}
          disabled={!range || (mode === "reading" && !reading)}
        >
          建立时间单元
        </button>
      </div>
      <div className={styles.list}>
        {units.length ? (
          units.map((unit, index) => (
            <TimingUnitRow
              key={unit.id}
              line={line}
              unit={unit}
              index={index}
              units={units}
              selected={selected === unit.id}
              onSelect={() => {
                setSelected(unit.id);
                onSelect?.(unit.id);
              }}
              onCommit={commit}
            />
          ))
        ) : (
          <p className={styles.empty}>
            暂无时间单元，请选择正文或读音范围建立。
          </p>
        )}
      </div>
    </section>
  );
}

function TimingUnitRow({
  line,
  unit,
  index,
  units,
  selected,
  onSelect,
  onCommit,
}: {
  line: StudioLine;
  unit: TimingUnit;
  index: number;
  units: TimingUnit[];
  selected: boolean;
  onSelect: () => void;
  onCommit: (units: TimingUnit[]) => boolean;
}) {
  const [begin, setBegin] = useState(
    unit.beginUs == null ? "" : String(unit.beginUs / 1e6),
  );
  const [end, setEnd] = useState(
    unit.endUs == null ? "" : String(unit.endUs / 1e6),
  );
  useEffect(() => {
    setBegin(unit.beginUs == null ? "" : String(unit.beginUs / 1e6));
    setEnd(unit.endUs == null ? "" : String(unit.endUs / 1e6));
  }, [unit.beginUs, unit.endUs]);
  const ruby = line.ruby.find((item) => item.id === unit.rubyId);
  const readingPart =
    ruby && unit.readingStart != null && unit.readingEnd != null
      ? chars(ruby.reading).slice(unit.readingStart, unit.readingEnd).join("")
      : ruby?.reading;
  const label = ruby
    ? `${ruby.base} · ${readingPart ?? ruby.reading}`
    : chars(line.text).slice(unit.textStart, unit.textEnd).join("");
  const kindLabel =
    kinds.find(([value]) => value === unit.kind)?.[1] ?? unit.kind;
  const save = (field: "beginUs" | "endUs", value: string) => {
    const parsed =
      value.trim() === ""
        ? null
        : Number(value) >= 0 && Number.isFinite(Number(value))
          ? Math.round(Number(value) * 1e6)
          : undefined;
    if (parsed === undefined) return;
    const accepted = onCommit(
      units.map((item) =>
        item.id === unit.id ? { ...item, [field]: parsed } : item,
      ),
    );
    if (!accepted) {
      setBegin(unit.beginUs == null ? "" : String(unit.beginUs / 1e6));
      setEnd(unit.endUs == null ? "" : String(unit.endUs / 1e6));
    }
  };
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const isRubyUnit = Boolean(
    ruby && unit.readingStart != null && unit.readingEnd != null,
  );
  const split = () => {
    const cut = splitAt;
    if (cut == null) return;
    const textCut = isRubyUnit ? null : cut;
    if (!isRubyUnit && (textCut! <= unit.textStart || textCut! >= unit.textEnd))
      return;
    if (isRubyUnit && (cut <= unit.readingStart! || cut >= unit.readingEnd!))
      return;
    const middle =
      unit.beginUs != null && unit.endUs != null
        ? Math.round((unit.beginUs + unit.endUs) / 2)
        : null;
    const readingCut = isRubyUnit ? cut : null;
    onCommit(
      units.flatMap((item) =>
        item.id === unit.id
          ? [
              {
                ...unit,
                id: `${unit.id}-a`,
                textEnd: textCut ?? unit.textEnd,
                readingEnd: readingCut,
                endUs: middle,
              },
              {
                ...unit,
                id: `${unit.id}-b`,
                textStart: textCut ?? unit.textStart,
                readingStart: readingCut,
                beginUs: middle,
              },
            ]
          : [item],
      ),
    );
  };
  const next = units[index + 1];
  const readingAdjacent =
    unit.readingEnd == null ||
    next?.readingStart == null ||
    unit.readingEnd === next.readingStart;
  const canMerge = Boolean(
    next &&
      next.kind === unit.kind &&
      next.rubyId === unit.rubyId &&
      (isRubyUnit
        ? unit.readingEnd === next.readingStart
        : next.textStart === unit.textEnd),
  );
  const merge = () => {
    if (
      !next ||
      next.kind !== unit.kind ||
      next.rubyId !== unit.rubyId ||
      (!isRubyUnit && next.textStart !== unit.textEnd) ||
      !readingAdjacent ||
      !canMerge
    )
      return;
    onCommit(
      units.flatMap((item, i) =>
        i === index
          ? [
              {
                ...unit,
                textEnd: next.textEnd,
                readingEnd: next.readingEnd,
                endUs: next.endUs,
              },
            ]
          : i === index + 1
            ? []
            : [item],
      ),
    );
  };
  const splitOffset = ruby?.baseStart ?? unit.textStart;
  const splitText = ruby
    ? chars(ruby.reading).slice(unit.readingStart!, unit.readingEnd!).join("")
    : chars(line.text).slice(unit.textStart, unit.textEnd).join("");
  const updateSplitAt = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const cursor = event.currentTarget.selectionStart;
    const local = chars(splitText.slice(0, cursor)).length;
    const absolute = (isRubyUnit ? unit.readingStart! : splitOffset) + local;
    const lower = isRubyUnit ? unit.readingStart! : unit.textStart;
    const upper = isRubyUnit ? unit.readingEnd! : unit.textEnd;
    setSplitAt(absolute > lower && absolute < upper ? absolute : null);
  };
  return (
    <article
      className={`${styles.unit} ${selected ? styles.selected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.unitHead}>
        <strong>{label}</strong>
        <span>{kindLabel}</span>
      </div>
      {selected && (
        <textarea
          key={`${unit.id}-${splitText}`}
          rows={1}
          className={styles.splitInput}
          aria-label="拆分边界"
          aria-readonly="true"
          defaultValue={splitText}
          onBeforeInput={(event) => event.preventDefault()}
          onChange={(event) => {
            event.currentTarget.value = splitText;
          }}
          onSelect={updateSplitAt}
          onKeyUp={updateSplitAt}
        />
      )}
      <div className={styles.range}>
        <input
          aria-label="开始时间（秒）"
          value={begin}
          placeholder="未定"
          onChange={(event) => setBegin(event.target.value)}
          onBlur={() => save("beginUs", begin)}
          onKeyDown={(event) => event.key === "Enter" && save("beginUs", begin)}
        />
        <span>—</span>
        <input
          aria-label="结束时间（秒）"
          value={end}
          placeholder="未定"
          onChange={(event) => setEnd(event.target.value)}
          onBlur={() => save("endUs", end)}
          onKeyDown={(event) => event.key === "Enter" && save("endUs", end)}
        />
      </div>
      <TimingTrack line={line} unit={unit} units={units} onCommit={onCommit} />
      <div className={styles.actions}>
        <button onClick={split} disabled={splitAt == null}>
          拆分
        </button>
        <button onClick={merge} disabled={!canMerge}>
          合并相邻单元
        </button>
        <button
          onClick={() => onCommit(units.filter((item) => item.id !== unit.id))}
        >
          删除
        </button>
      </div>
    </article>
  );
}

function TimingTrack({
  line,
  unit,
  units,
  onCommit,
}: {
  line: StudioLine;
  unit: TimingUnit;
  units: TimingUnit[];
  onCommit: (units: TimingUnit[]) => boolean;
}) {
  const [preview, setPreview] = useState(unit);
  const drag = useRef<{
    mode: "start" | "end" | "move";
    x: number;
    begin: number;
    end: number;
    width: number;
  } | null>(null);
  useEffect(() => setPreview(unit), [unit.beginUs, unit.endUs]);
  const lineBegin = line.beginUs ?? unit.beginUs ?? 0;
  const lineEnd = line.endUs ?? unit.endUs ?? lineBegin + 1;
  const begin = preview.beginUs ?? lineBegin;
  const end = preview.endUs ?? begin;
  const finish = () => {
    if (drag.current) {
      const accepted = onCommit(
        units.map((item) => (item.id === unit.id ? preview : item)),
      );
      if (!accepted) setPreview(unit);
      drag.current = null;
    }
  };
  return (
    <div
      className={styles.track}
      aria-label="时间单元时间条"
      onPointerDown={(event) => {
        if (unit.beginUs == null || unit.endUs == null) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const position = (event.clientX - rect.left) / rect.width;
        const left = (begin - lineBegin) / Math.max(1, lineEnd - lineBegin);
        const right = (end - lineBegin) / Math.max(1, lineEnd - lineBegin);
        drag.current = {
          mode:
            Math.abs(position - left) < 0.1
              ? "start"
              : Math.abs(position - right) < 0.1
                ? "end"
                : "move",
          x: event.clientX,
          begin,
          end,
          width: rect.width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const delta = Math.round(
          ((event.clientX - state.x) / state.width) *
            Math.max(1, lineEnd - lineBegin),
        );
        const nextBegin =
          state.mode === "start"
            ? state.begin + delta
            : state.mode === "move"
              ? state.begin + delta
              : state.begin;
        const nextEnd = state.mode === "start" ? state.end : state.end + delta;
        if (nextBegin >= lineBegin && nextEnd <= lineEnd && nextBegin < nextEnd)
          setPreview({ ...unit, beginUs: nextBegin, endUs: nextEnd });
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        setPreview(unit);
        drag.current = null;
      }}
    >
      <span
        style={{
          left: `${((begin - lineBegin) / Math.max(1, lineEnd - lineBegin)) * 100}%`,
          width: `${Math.max(2, ((end - begin) / Math.max(1, lineEnd - lineBegin)) * 100)}%`,
        }}
      />
    </div>
  );
}
