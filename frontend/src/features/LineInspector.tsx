import { useEffect, useState } from "react";
import type { StudioLine } from "../domain/document";

export function LineInspector({
  line,
  onChange,
}: {
  line?: StudioLine;
  onChange: (
    changes: Partial<Pick<StudioLine, "text" | "beginUs" | "endUs">>,
  ) => void;
}) {
  const [begin, setBegin] = useState(
    line?.beginUs == null ? "" : String(line?.beginUs / 1e6),
  );
  const [end, setEnd] = useState(
    line?.endUs == null ? "" : String(line?.endUs / 1e6),
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBegin(line?.beginUs == null ? "" : String(line.beginUs / 1e6));
    setEnd(line?.endUs == null ? "" : String(line.endUs / 1e6));
    setError(null);
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
          value={line.text}
          disabled={!line.editable.text}
          onChange={(event) => onChange({ text: event.target.value })}
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
    </aside>
  );
}
