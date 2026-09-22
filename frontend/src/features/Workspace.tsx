import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  studioApi,
  studioS4,
  type Asset,
  type ImportProposal,
} from "../adapters/http/client";
import type { JobResult } from "../adapters/http/jobs";
import type { LineUpdate } from "../domain/editing";
import { parseStudioTtml, serializeStudioTtml } from "../adapters/ttml";
import { useProjectDocument } from "./useProjectDocument";
import { MediaTransport } from "./MediaTransport";
import { CandidatePanel } from "./CandidatePanel";
import { JobPanel } from "./JobPanel";
import { JobCandidatePanel } from "./JobCandidatePanel";
import { ReviewPanel } from "./ReviewPanel";
import { LineInspector } from "./LineInspector";
import { LineTable } from "./LineTable";
import { AgentPanel } from "./AgentPanel";
import { RubyPanel } from "./RubyPanel";
import { ReadingDictionaryPanel } from "./ReadingDictionaryPanel";
import { TimingPanel } from "./TimingPanel";
import styles from "./workspace.module.css";

type Panel =
  | "lyrics"
  | "properties"
  | "candidates"
  | "tasks"
  | "agents"
  | "dictionary";
const labels: Record<Panel, string> = {
  lyrics: "歌词",
  properties: "属性",
  candidates: "候选",
  tasks: "任务",
  agents: "歌手",
  dictionary: "词典",
};
export function Workspace({ projectId }: { projectId: string }) {
  const document = useQuery({
    queryKey: ["document-envelope", projectId],
    queryFn: () => studioS4.getDocumentEnvelope(projectId),
  });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => studioApi.getProject(projectId),
  });
  if (document.isLoading)
    return <main className={styles.centerState}>正在加载歌词…</main>;
  if (document.isError || !document.data)
    return (
      <main className={styles.centerState}>
        <strong>无法打开项目文档</strong>
        <button onClick={() => document.refetch()}>重试</button>
      </main>
    );
  return (
    <Editor
      key={projectId}
      projectId={projectId}
      title={project.data?.name ?? "歌词项目"}
      revision={document.data.revision ?? ""}
      ttml={document.data.document.ttml}
      asset={project.data?.asset ?? null}
    />
  );
}

function Editor({
  projectId,
  title,
  revision: initialRevision,
  ttml,
  asset,
}: {
  projectId: string;
  title: string;
  revision: string;
  ttml: string;
  asset: Asset | null;
}) {
  const editor = useProjectDocument(
    projectId,
    ttml,
    initialRevision,
    undefined,
    async (
      xml: string,
      base: string,
      op: string,
      seq: number,
      etag?: string,
    ) => {
      const result = await studioS4.saveRichDocument(
        projectId,
        xml,
        base,
        op,
        seq,
        etag,
      );
      return { revision: result.revision, etag: result.etag };
    },
  );
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>("lyrics");
  const [sideTab, setSideTab] = useState<
    "candidates" | "tasks" | "agents" | "dictionary"
  >("candidates");
  const [propertyTab, setPropertyTab] = useState<
    "attributes" | "ruby" | "timing"
  >("attributes");
  const [selected, setSelected] = useState(0);
  const [candidate, setCandidate] = useState<ImportProposal | null>(null);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [message, setMessage] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const lines = editor.document.lines;
  const line = lines[selected];
  const selectedUnit = line?.timingUnits.find(
    (unit) => unit.id === selectedUnitId,
  );
  useEffect(() => {
    const id = params.get("line");
    const index = lines.findIndex(
      (item) => item.id === id || item.xmlId === id,
    );
    if (index >= 0) setSelected(index);
  }, [lines, params]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (editor.dirty || editor.saving || editor.conflict) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [editor.conflict, editor.dirty, editor.saving]);
  const edit = (id: string, changes: LineUpdate) => {
    try {
      editor.apply({ type: "update-line", lineId: id, changes });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "编辑失败");
    }
  };
  const selectLine = (index: number) => {
    setSelected(index);
    setSelectedUnitId(null);
    setParams(
      (current) => {
        current.set("line", lines[index]?.xmlId ?? lines[index]?.id ?? "");
        return current;
      },
      { replace: true },
    );
  };
  const applyImport = () => {
    if (
      !candidate ||
      editor.dirty ||
      candidate.input_revision !== editor.revision
    )
      return setMessage("候选已过期或有未保存编辑");
    const raw =
      candidate.candidate.ttml ??
      `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><div>${(
        candidate.candidate.lines ?? []
      )
        .map((item, index) => {
          const unknown = [
            item.begin_us == null ? "begin" : "",
            item.end_us == null ? "end" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<p xml:id="import-${index}"${unknown ? ` studio:null="${unknown}"` : ""}${item.begin_us == null ? "" : ` begin="${item.begin_us / 1e6}s"`}${item.end_us == null ? "" : ` end="${item.end_us / 1e6}s"`}>${escapeXml(item.text)}</p>`;
        })
        .join("")}</div></body></tt>`;
    try {
      editor.apply({
        type: "replace-document",
        document: parseStudioTtml(raw),
      });
      setCandidate(null);
    } catch {
      setMessage("候选无法应用");
    }
  };
  const side =
    sideTab === "tasks" ? (
      <JobPanel
        projectId={projectId}
        revision={editor.revision}
        assetId={asset?.id ?? null}
        dirty={editor.dirty}
        selectedLineIds={line ? [line.xmlId ?? line.id] : []}
        rubyOptions={
          line?.ruby.map((ruby) => ({
            id: ruby.id,
            base: ruby.base,
            reading: ruby.reading,
            baseStart: ruby.baseStart,
            baseEnd: ruby.baseEnd,
          })) ?? []
        }
        onCandidate={(result) => {
          setJobResult(result);
          setSideTab("candidates");
          setPanel("candidates");
        }}
      />
    ) : sideTab === "agents" ? (
      <AgentPanel
        agents={editor.document.agents}
        onChange={(agents) => editor.apply({ type: "update-agents", agents })}
      />
    ) : jobResult ? (
      <JobCandidatePanel
        result={jobResult}
        currentRevision={editor.revision}
        currentAssetId={asset?.id ?? null}
        dirty={editor.dirty}
        document={editor.document}
        onApply={(command) => {
          try {
            editor.apply(command);
            if (jobResult?.kind !== "reading") setJobResult(null);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "候选无法应用");
          }
        }}
      />
    ) : (
      <CandidatePanel
        proposal={candidate}
        currentRevision={editor.revision}
        dirty={editor.dirty}
        document={editor.document}
        onApply={applyImport}
      />
    );
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} to="/projects">
          Lazulite <span>Studio</span>
        </Link>
        <strong>{title}</strong>
        <span className={styles.saveState}>
          {editor.conflict
            ? "● 冲突"
            : editor.saving
              ? "● 保存中"
              : editor.dirty
                ? "● 未保存"
                : "✓ 已保存"}
        </span>
        <nav className={styles.topActions}>
          <button
            onClick={() => void editor.save()}
            disabled={!editor.dirty || editor.saving || editor.conflict}
          >
            保存
          </button>
          <button onClick={editor.undo} disabled={!editor.canUndo}>
            撤销
          </button>
          <button onClick={editor.redo} disabled={!editor.canRedo}>
            重做
          </button>
          <button
            onClick={() => {
              if (editor.dirty || editor.saving || editor.conflict) {
                setMessage("请先保存，发布与下载需要使用已保存版本");
                return;
              }
              navigate(`/projects/${projectId}/export`);
            }}
          >
            发布与下载
          </button>
          <button
            onClick={() => {
              try {
                download(
                  serializeStudioTtml(editor.document, { draft: false }),
                );
              } catch {
                setMessage("导出失败");
              }
            }}
          >
            导出最终 TTML
          </button>
        </nav>
      </header>
      {editor.recovery.available && (
        <div className={styles.conflict}>
          发现本地草稿{" "}
          <button
            onClick={() =>
              void editor
                .restore()
                .catch((error) =>
                  setMessage(
                    error instanceof Error ? error.message : "恢复失败",
                  ),
                )
            }
          >
            恢复
          </button>
          <button
            onClick={() =>
              void editor
                .discardRecovery()
                .catch((error) =>
                  setMessage(
                    error instanceof Error ? error.message : "丢弃失败",
                  ),
                )
            }
          >
            丢弃
          </button>
        </div>
      )}
      {editor.conflict && (
        <div className={styles.conflict}>
          服务器已有新版本，本地草稿已保留{" "}
          <button
            onClick={() => {
              try {
                download(serializeStudioTtml(editor.document, { draft: true }));
              } catch {
                setMessage("本地草稿导出失败");
              }
            }}
          >
            下载本地草稿
          </button>
          <button
            onClick={() => {
              if (!window.confirm("重新加载服务器版本并清除本地检查点？"))
                return;
              void editor
                .discardRecovery()
                .then(() => window.location.reload())
                .catch((error) =>
                  setMessage(
                    error instanceof Error ? error.message : "重新加载失败",
                  ),
                );
            }}
          >
            重新加载服务器
          </button>
        </div>
      )}
      <div className={styles.modebar}>
        <label className={styles.importButton}>
          导入 TTML/LRC/text
          <input
            type="file"
            hidden
            accept=".ttml,.xml,.lrc,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void file
                  .text()
                  .then((content) =>
                    studioS4.importLyrics(
                      projectId,
                      editor.revision,
                      file.name,
                      content,
                    ),
                  )
                  .then(setCandidate)
                  .catch((error) => setMessage(error.message));
            }}
          />
        </label>
        <span>{message || editor.error || ""}</span>
      </div>
      <nav className={styles.mobilePanels}>
        {(Object.keys(labels) as Panel[]).map((value) => (
          <button
            key={value}
            className={panel === value ? styles.tabActive : ""}
            onClick={() => {
              setPanel(value);
              if (
                value === "candidates" ||
                value === "tasks" ||
                value === "agents"
              )
                setSideTab(value);
              if (value === "dictionary") setSideTab(value);
            }}
          >
            {labels[value]}
          </button>
        ))}
      </nav>
      <div className={styles.workspace}>
        <aside
          className={`${styles.panel} ${styles.leftPanel} ${panel === "lyrics" || panel === "properties" ? styles.mobileHidden : styles.mobileVisible}`}
        >
          <div className={styles.panelHeader}>
            <button onClick={() => setSideTab("candidates")}>候选</button>
            <button onClick={() => setSideTab("tasks")}>任务</button>
            <button onClick={() => setSideTab("agents")}>歌手</button>
            <button onClick={() => setSideTab("dictionary")}>词典</button>
          </div>
          <div className={styles.sideContent}>
            {sideTab === "dictionary" ? (
              <ReadingDictionaryPanel projectId={projectId} />
            ) : (
              side
            )}
          </div>
        </aside>
        <LineTable
          lines={lines}
          selected={selected}
          onSelect={selectLine}
          onEdit={edit}
          agents={editor.document.agents}
          visible={panel === "lyrics"}
        />
        <aside
          className={`${styles.panel} ${styles.rightPanel} ${panel === "properties" ? styles.mobileVisible : styles.mobileHidden}`}
        >
          <div className={styles.panelTabs}>
            <button
              aria-label="行属性"
              className={propertyTab === "attributes" ? styles.tabActive : ""}
              onClick={() => setPropertyTab("attributes")}
            >
              属性
            </button>
            <button
              className={propertyTab === "ruby" ? styles.tabActive : ""}
              onClick={() => setPropertyTab("ruby")}
            >
              注音
            </button>
            <button
              className={propertyTab === "timing" ? styles.tabActive : ""}
              onClick={() => setPropertyTab("timing")}
            >
              时间
            </button>
          </div>
          {line && (
            <div className={styles.propertyContent}>
              {propertyTab === "timing" ? (
                <TimingPanel
                  line={line}
                  onSelect={setSelectedUnitId}
                  onChange={(units) => {
                    try {
                      editor.apply({
                        type: "update-timing-units",
                        lineId: line.id,
                        units,
                      });
                      return true;
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "时间单元编辑失败",
                      );
                      return false;
                    }
                  }}
                />
              ) : propertyTab === "ruby" ? (
                <>
                  <RubyPanel
                    line={line}
                    onApply={(ruby) => {
                      try {
                        editor.apply({
                          type: "update-ruby",
                          lineId: line.id,
                          ruby,
                        });
                      } catch (error) {
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : "注音编辑失败",
                        );
                      }
                    }}
                  />
                  <ReviewPanel
                    projectId={projectId}
                    revision={editor.revision}
                    lineId={line.xmlId ?? line.id}
                    dirty={editor.dirty}
                  />
                </>
              ) : (
                <>
                  <p>{line.text}</p>
                  <LineInspector
                    line={line}
                    onChange={(changes) => edit(line.id, changes)}
                    onSplit={(at) => {
                      try {
                        editor.apply({
                          type: "split-line",
                          lineId: line.id,
                          at,
                          newLineId: `${line.id}-split-${Date.now()}`,
                        });
                      } catch (error) {
                        setMessage(
                          error instanceof Error ? error.message : "拆分失败",
                        );
                      }
                    }}
                    onMerge={
                      selected < lines.length - 1
                        ? () => {
                            try {
                              editor.apply({
                                type: "merge-lines",
                                firstLineId: line.id,
                                secondLineId: lines[selected + 1].id,
                              });
                            } catch (error) {
                              setMessage(
                                error instanceof Error
                                  ? error.message
                                  : "合并失败",
                              );
                            }
                          }
                        : undefined
                    }
                    onShift={(deltaUs) => {
                      try {
                        editor.apply({
                          type: "shift-line",
                          lineId: line.id,
                          deltaUs,
                        });
                      } catch (error) {
                        setMessage(
                          error instanceof Error ? error.message : "平移失败",
                        );
                      }
                    }}
                  />
                  <ReviewPanel
                    projectId={projectId}
                    revision={editor.revision}
                    lineId={line.xmlId ?? line.id}
                    dirty={editor.dirty}
                  />
                </>
              )}
            </div>
          )}
        </aside>
      </div>
      <MediaTransport
        projectId={projectId}
        lines={lines.map((item) => ({
          id: item.id,
          text: item.text,
          begin_us: item.beginUs,
          end_us: item.endUs,
        }))}
        selectedLine={
          line
            ? {
                id: line.id,
                text: line.text,
                begin_us: line.beginUs,
                end_us: line.endUs,
              }
            : undefined
        }
        loopRange={
          selectedUnit?.beginUs != null && selectedUnit.endUs != null
            ? { begin_us: selectedUnit.beginUs, end_us: selectedUnit.endUs }
            : undefined
        }
        asset={asset}
      />
    </div>
  );
}

function escapeXml(value: string) {
  return value.replace(
    /[<>&'\"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character,
  );
}
function download(value: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/ttml+xml" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "lyrics.ttml";
  anchor.click();
  URL.revokeObjectURL(url);
}
