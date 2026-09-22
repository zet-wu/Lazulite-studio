import { useEffect, useState } from "react";
import type { StudioLine } from "../domain/document";

export function LineInspector({
  line,
  onChange,
  onSplit,
  onMerge,
  onShift,
}: {
  line?: StudioLine;
  onChange: (
    changes: Partial<Pick<StudioLine, "text" | "beginUs" | "endUs">>,
  ) => void;
  onSplit?: (at: number) => void;
  onMerge?: () => void;
  onShift?: (deltaUs: number) => void;
}) {
  const [begin, setBegin] = useState(
    line?.beginUs == null ? "" : String(line?.beginUs / 1e6),
  );
  const [end, setEnd] = useState(
    line?.endUs == null ? "" : String(line?.endUs / 1e6),
  );
  const [error, setError] = useState<string | null>(null);
  const [splitAt, setSplitAt] = useState<number | null>(null);
  useEffect(() => {
    setBegin(line?.beginUs == null ? "" : String(line.beginUs / 1e6));
    setEnd(line?.endUs == null ? "" : String(line.endUs / 1e6));
    setError(null);
    setSplitAt(null);
  }, [line?.id, line?.beginUs, line?.endUs]);
  const commit = () => {
    const parse = (value: string) =>
      value.trim() === "" ? null : Number(value) * 1e6;
    const nextBegin = parse(begin);
    const nextEnd = parse(end);
    if (
      (nextBegin !== null &&
        (!Number.isSafeInteger(nextBegin) || nextBegin < 0)) ||
      (nextEnd !== null && (!Number.isSafeInteger(nextEnd) || nextEnd < 0))
    ) {
      setError("时间必须是非负整数微秒");
      return;
    }
    if (nextBegin !== null && nextEnd !== null && nextBegin > nextEnd) {
      setError("开始时间不能晚于结束时间");
      return;
    }
    setError(null);
    onChange({ beginUs: nextBegin, endUs: nextEnd });
  };
  if (!line) return <aside aria-label="行属性">请选择一行</aside>;
  return (
    <aside aria-label="行属性">
      <strong>行属性</strong>
      <label>
        正文
        <input
          aria-label="正文"
          value={line.text}
          disabled={!line.editable.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onSelect={(event) => {
            if (!onSplit) return;
            setSplitAt(
              Array.from(
                line.text.slice(0, event.currentTarget.selectionStart ?? 0),
              ).length,
            );
          }}
        />
      </label>
      <label>
        开始（秒）
        <input
          value={begin}
          disabled={!line.editable.timing}
          onChange={(event) => setBegin(event.target.value)}
          onBlur={commit}
        />
      </label>
      <label>
        结束（秒）
        <input
          value={end}
          disabled={!line.editable.timing}
          onChange={(event) => setEnd(event.target.value)}
          onBlur={commit}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="lineActions">
        {onSplit && (
          <button
            type="button"
            disabled={
              splitAt == null ||
              splitAt <= 0 ||
              splitAt >= Array.from(line.text).length
            }
            onClick={() => splitAt != null && onSplit(splitAt)}
          >
            在光标处拆分
          </button>
        )}
        {onMerge && (
          <button type="button" onClick={onMerge}>
            与下一行合并
          </button>
        )}
        {onShift && (
          <button type="button" onClick={() => onShift(-10000)}>
            整体前移 10ms
          </button>
        )}
        {onShift && (
          <button type="button" onClick={() => onShift(10000)}>
            整体后移 10ms
          </button>
        )}
      </div>
    </aside>
  );
}
