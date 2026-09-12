import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../adapters/http/client";
import { reviewApi } from "../adapters/http/review";

export function ReviewPanel({
  projectId,
  revision,
  lineId,
  dirty,
}: {
  projectId: string;
  revision: string;
  lineId?: string;
  dirty: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["review", projectId, revision],
    queryFn: () => reviewApi.get(projectId),
  });
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const item = query.data?.items.find((entry) => entry.line_id === lineId);
  useEffect(() => {
    setMessage("");
    setNote(item?.note ?? "");
  }, [revision, lineId, item?.note]);
  const save = async (confirmed: boolean) => {
    if (!lineId || dirty || !query.data) return;
    try {
      setBusy(true);
      await reviewApi.patch(
        projectId,
        lineId,
        revision,
        query.data.version,
        confirmed,
        note,
      );
      await client.invalidateQueries({ queryKey: ["review", projectId] });
      setMessage(confirmed ? "已确认" : "已取消确认");
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 412
          ? "版本已变化，请重新读取页面"
          : error instanceof ApiError
            ? error.body.message
            : "保存失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };
  if (query.isError)
    return (
      <aside aria-label="审核">
        <p>审核状态读取失败</p>
        <button onClick={() => query.refetch()}>重试</button>
      </aside>
    );
  if (!lineId)
    return (
      <aside aria-label="审核">
        <p>请选择一行</p>
      </aside>
    );
  const statusLabel =
    item?.status === "confirmed"
      ? "已确认"
      : item?.status === "stale"
        ? "需重新确认"
        : "未确认";
  return (
    <aside aria-label="审核">
      <strong>审核</strong>
      <p>状态：{statusLabel}</p>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="备注"
      />
      {dirty && <p>有未保存编辑，保存后才能确认。</p>}
      <button
        disabled={dirty || query.isLoading || busy}
        onClick={() => save(true)}
      >
        确认
      </button>
      <button
        disabled={dirty || query.isLoading || busy}
        onClick={() => save(false)}
      >
        取消确认
      </button>
      {message && <p role="status">{message}</p>}
    </aside>
  );
}
