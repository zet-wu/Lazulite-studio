import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { parseLyricTtml, serializeLyricTtml } from "../adapters/ttml/lyric-codec";
import { publishingApi, type ExportItem } from "../adapters/http/publishing";
import { studioApi, studioS4 } from "../adapters/http/client";
import styles from "./export-page.module.css";

const activeStatuses = new Set([
  "processing",
  "queued",
  "running",
  "cancel_requested",
]);
const statusText = (item: ExportItem) =>
  item.status === "failed"
    ? "失败"
    : activeStatuses.has(item.status)
      ? "处理中"
      : item.status === "cancelled"
        ? "已取消"
        : item.status === "interrupted"
          ? "已中断"
          : item.status === "unavailable"
            ? "文件不可用"
            : item.download_url
              ? item.stale
                ? "旧版本 · 可下载"
                : "可下载"
              : "文件不可用";
const statusClass = (item: ExportItem) =>
  item.status === "failed"
    ? styles.failed
    : activeStatuses.has(item.status)
      ? styles.processing
      : item.stale
        ? styles.stale
        : styles.ready;
const reportFields: Array<[keyof NonNullable<ExportItem["report"]>, string]> = [
  ["audio_streams", "音轨流"],
  ["audio_preserved", "音轨保留"],
  ["metadata_preserved", "元数据保留"],
  ["subtitle_handler", "字幕处理器"],
  ["subtitle_codec", "字幕编码"],
  ["sample_count", "sample 数"],
  ["ttml_sha256", "TTML 校验"],
  ["passed", "验证结果"],
];
export function validatePublishDocument(ttml: string) {
  const document = parseLyricTtml(ttml);
  if (document.lines.some((line) => !line.backgroundOf && (line.beginUs === null || line.endUs === null)))
    throw new Error('发布需要每行歌词的开始和结束时间');
  return serializeLyricTtml(document);
}

export function ExportPage() {
  const { projectId = "" } = useParams();
  const client = useQueryClient();
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => studioApi.getProject(projectId),
  });
  const documentQuery = useQuery({
    queryKey: ["document-envelope", projectId],
    queryFn: () => studioS4.getDocumentEnvelope(projectId),
    refetchOnMount: "always",
    staleTime: 0,
  });
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: studioApi.getCapabilities,
  });
  const exportsQuery = useQuery({
    queryKey: ["exports", projectId],
    queryFn: () => publishingApi.list(projectId),
    refetchOnMount: "always",
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => activeStatuses.has(item.status))
        ? 2000
        : false,
  });
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const supportedAsset =
    project.data?.asset?.content_type === "audio/mp4" ||
    project.data?.asset?.content_type === "video/mp4";
  const publish = async () => {
    if (busy) return;
    if (!documentQuery.data || !project.data?.asset?.id) {
      setMessage("当前项目没有可用音轨");
      return;
    }
    setMessage("");
    setBusy(true);
    setValid(null);
    try {
      try {
        validatePublishDocument(documentQuery.data.document.ttml);
      } catch (error) {
        setValid(false);
        throw error;
      }
      setValid(true);
      await publishingApi.publish(
        projectId,
        documentQuery.data.revision,
        project.data.asset.id,
      );
      setMessage("发布请求已提交，可在右侧查看结果");
      await client.invalidateQueries({ queryKey: ["exports", projectId] });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `发布失败：${error.message}`
          : "发布失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.back} to={`/projects/${projectId}/edit`}>
          ‹ 返回编辑
        </Link>
        <h1 className={styles.title}>
          发布与下载 · {project.data?.name ?? "歌词项目"}
        </h1>
      </header>
      <div className={styles.body}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>当前版本</div>
          <div className={styles.version}>
            {(project.isError || documentQuery.isError) && (
              <p className={styles.error}>
                版本读取失败{" "}
                <button
                  className={styles.retry}
                  onClick={() => {
                    void project.refetch();
                    void documentQuery.refetch();
                  }}
                >
                  重试
                </button>
              </p>
            )}
            <p className={styles.description}>
              将已保存歌词嵌入源音乐文件，生成独立副本。支持
              MP4/M4A，当前不会转码。
            </p>
            <dl className={styles.meta}>
              <dt>源文件</dt>
              <dd>{project.data?.asset?.filename ?? "未关联音轨"}</dd>
              <dt>已保存版本</dt>
              <dd>{documentQuery.data?.revision ?? "读取中…"}</dd>
              <dt>校验状态</dt>
              <dd
                className={
                  valid === false || documentQuery.isError
                    ? styles.invalid
                    : valid === true
                      ? styles.valid
                      : undefined
                }
              >
                {documentQuery.isLoading
                  ? "正在检查…"
                  : documentQuery.isError
                    ? "无法读取"
                    : valid === false
                      ? "校验失败"
                      : valid === true
                        ? "校验通过"
                        : "尚未检查"}
              </dd>
            </dl>
            <button
              className={styles.primary}
              onClick={() => void publish()}
              disabled={
                !documentQuery.data ||
                !supportedAsset ||
                busy ||
                documentQuery.isFetching ||
                project.isFetching ||
                documentQuery.isError ||
                project.isError ||
                !capabilities.data?.items.some(
                  (item) => item.id === "publish.stpp" && item.enabled,
                )
              }
            >
              {" "}
              {busy ? "正在检查…" : "生成音乐文件"}
            </button>
            {capabilities.data &&
              !capabilities.data.items.some(
                (item) => item.id === "publish.stpp" && item.enabled,
              ) && (
                <p className={styles.error}>
                  {capabilities.data.items.find(
                    (item) => item.id === "publish.stpp",
                  )?.reason ?? "当前环境未启用发布能力"}
                </p>
              )}
            <button
              className={styles.secondary}
              onClick={() => {
                if (!documentQuery.data) return;
                try {
                  const blob = new Blob(
                    [validatePublishDocument(documentQuery.data.document.ttml)],
                    { type: "application/ttml+xml" },
                  );
                  const url = URL.createObjectURL(blob);
                  const anchor = window.document.createElement("a");
                  anchor.href = url;
                  anchor.download = `${project.data?.name ?? projectId}.ttml`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                  setMessage("TTML 已开始下载");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? `下载失败：${error.message}`
                      : "下载失败",
                  );
                }
              }}
            >
              下载 TTML
            </button>
            {message && (
              <p
                className={
                  message.startsWith("发布失败") ||
                  message.startsWith("下载失败")
                    ? styles.error
                    : styles.notice
                }
                role="status"
              >
                {message}
              </p>
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>发布记录</div>
          {exportsQuery.isLoading ? (
            <p className={styles.empty}>正在读取发布记录…</p>
          ) : exportsQuery.isError ? (
            <div className={styles.empty}>
              发布记录读取失败
              <button
                className={styles.retry}
                onClick={() => void exportsQuery.refetch()}
              >
                重试
              </button>
            </div>
          ) : exportsQuery.data?.items.length ? (
            <div className={styles.list}>
              {exportsQuery.data.items.map((item) => (
                <article className={styles.item} key={item.id}>
                  <div className={styles.itemHeader}>
                    <button
                      aria-expanded={expanded === item.id}
                      className={styles.itemHeaderButton}
                      onClick={() =>
                        setExpanded(expanded === item.id ? null : item.id)
                      }
                    >
                      <span className={`${styles.status} ${statusClass(item)}`}>
                        {statusText(item)}
                      </span>
                      <span title={item.revision}>
                        版本 {item.revision.slice(0, 12)}
                        {item.revision.length > 12 ? "…" : ""}
                      </span>
                    </button>
                    {item.download_url ? (
                      <a className={styles.download} href={item.download_url}>
                        下载
                      </a>
                    ) : null}
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  </div>
                  {expanded === item.id && (
                    <div className={styles.report}>
                      {item.error && (
                        <div className={styles.reportRow}>
                          <span>错误</span>
                          <span>
                            {typeof item.error === "string"
                              ? item.error
                              : item.error.message
                                ? String(item.error.message)
                                : "发布失败"}
                          </span>
                        </div>
                      )}
                      {reportFields.map(([key, label]) =>
                        item.report?.[key] != null ? (
                          <div className={styles.reportRow} key={key}>
                            <span>{label}</span>
                            <span>
                              {key === "passed" ||
                              key === "audio_preserved" ||
                              key === "metadata_preserved"
                                ? item.report?.[key]
                                  ? "通过"
                                  : "未通过"
                                : String(item.report?.[key])}
                            </span>
                          </div>
                        ) : null,
                      )}
                      {!item.error && !item.report && <span>暂无回读报告</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              还没有发布记录。生成音乐文件后，处理结果会显示在这里。
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
