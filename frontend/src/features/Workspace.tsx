import { useEffect, useRef, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  studioApi,
  type DocumentShell,
  type JobList,
  type Asset,
} from "../adapters/http/client";
import { Icon } from "../shared/Icon";
import { MediaTransport } from "./MediaTransport";
import styles from "./workspace.module.css";

type Panel = "lyrics" | "candidates" | "tasks" | "properties";
const panels: Panel[] = ["lyrics", "candidates", "tasks", "properties"];
const time = (us: number | null) => {
  if (us == null) return "--:--.---";
  const millis = Math.max(0, Math.floor(us / 1_000));
  const minutes = Math.floor(millis / 60_000);
  const seconds = Math.floor(millis / 1_000) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis % 1_000).padStart(3, "0")}`;
};

export function Workspace({ projectId }: { projectId: string }) {
  const [routeParams] = useSearchParams();
  const scenario = routeParams.get("scenario");
  const projectsPath = scenario
    ? `/projects?scenario=${encodeURIComponent(scenario)}`
    : "/projects";
  const query = useQuery({
    queryKey: ["document", projectId],
    queryFn: () => studioApi.getDocument(projectId),
  });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => studioApi.getProject(projectId),
  });
  if (query.isLoading)
    return (
      <main className={styles.centerState}>
        <span className={styles.spinner} />
        正在加载歌词…
      </main>
    );
  if (projectQuery.isError)
    return (
      <main className={styles.centerState}>
        <strong>媒体信息加载失败</strong>
        <button
          className={styles.secondary}
          onClick={() => projectQuery.refetch()}
        >
          重试
        </button>
      </main>
    );
  if (query.isError || !query.data)
    return (
      <main className={styles.centerState}>
        <strong>无法打开项目</strong>
        <p className={styles.muted}>项目文档不存在或服务暂时不可用。</p>
        <button className={styles.secondary} onClick={() => query.refetch()}>
          重试
        </button>
        <Link to={projectsPath}>返回项目</Link>
      </main>
    );
  return (
    <WorkspaceContent
      projectId={projectId}
      document={query.data}
      asset={projectQuery.data?.asset ?? null}
    />
  );
}

function WorkspaceContent({
  projectId,
  document,
  asset,
}: {
  projectId: string;
  document: DocumentShell;
  asset: Asset | null;
}) {
  const [params, setParams] = useSearchParams();
  const lines = document.lines;
  const lineId = params.get("line");
  const scenario = params.get("scenario");
  const withScenario = (path: string) =>
    scenario ? `${path}?scenario=${encodeURIComponent(scenario)}` : path;
  const selected = Math.max(
    0,
    lines.findIndex((line) => line.id === lineId),
  );
  const requestedPanel = params.get("panel") as Panel | null;
  const panel: Panel =
    requestedPanel && panels.includes(requestedPanel)
      ? requestedPanel
      : "lyrics";
  const jobs = useQuery({
    queryKey: ["jobs", projectId],
    queryFn: () => studioApi.listJobs(projectId),
  });
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const update = (next: Partial<{ line: string; panel: Panel }>) =>
    setParams(
      (current) => {
        if (next.line !== undefined) current.set("line", next.line);
        if (next.panel !== undefined) current.set("panel", next.panel);
        return current;
      },
      { replace: true },
    );
  useEffect(() => {
    if (!lineId && lines[0]) update({ line: lines[0].id });
  }, [lineId, lines]);
  const focusRow = (index: number) => {
    update({ line: lines[index]?.id ?? "" });
    refs.current[index]?.focus();
  };
  const move = (index: number, delta: number) =>
    focusRow(Math.max(0, Math.min(lines.length - 1, index + delta)));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} to={withScenario("/projects")}>
          Lazulite <span>Studio</span>
        </Link>
        <span className={styles.topDivider} />
        <Link to={withScenario("/projects")} className={styles.breadcrumb}>
          项目
        </Link>
        <Icon name="chevron" size={13} />
        <strong className={styles.breadcrumb}>{document.title}</strong>
        <span className={styles.saveState}>● 只读</span>
        <nav className={styles.topActions}>
          <Link to={withScenario(`/projects/${projectId}/export`)}>导出</Link>
          <Link to={withScenario("/settings")}>设置</Link>
        </nav>
      </header>
      <div className={styles.modebar}>
        <span className={styles.modeActive}>歌词制作</span>
        <button disabled title="预览能力尚未接入">
          预览
        </button>
        <button disabled title="发布能力尚未接入">
          发布
        </button>
        <span className={styles.modeSpacer} />
        <span className={styles.readonlyTag}>
          只读文档 · {document.revision}
        </span>
      </div>
      <nav className={styles.mobilePanels} aria-label="工作区面板">
        {panels.map((value) => (
          <button
            key={value}
            className={panel === value ? styles.tabActive : ""}
            onClick={() => update({ panel: value })}
          >
            {value === "lyrics"
              ? "歌词"
              : value === "candidates"
                ? "候选"
                : value === "tasks"
                  ? `任务${jobs.data?.items.length ? ` (${jobs.data.items.length})` : ""}`
                  : "属性"}
          </button>
        ))}
      </nav>
      <div className={styles.workspace}>
        <SourcePanel
          panel={panel}
          jobs={jobs}
          onPanel={(value) => update({ panel: value })}
        />
        <main
          className={`${styles.editor} ${panel === "lyrics" ? styles.mobileVisible : styles.mobileHidden}`}
        >
          <div className={styles.editorHeader}>
            <div>
              <div className={styles.eyebrow}>LYRICS / READ ONLY</div>
              <h1>歌词行表</h1>
            </div>
            <div className={styles.editorTools}>
              <button disabled title="保存服务尚未接入">
                保存
              </button>
              <button disabled title="撤销尚未接入">
                撤销
              </button>
            </div>
          </div>
          <LineTable
            lines={lines}
            selected={selected}
            refs={refs}
            onSelect={(index) => update({ line: lines[index]?.id ?? "" })}
            onMove={move}
          />
        </main>
        <Inspector
          document={document}
          line={lines[selected]}
          visible={panel === "properties"}
        />
      </div>
      <MediaTransport
        key={projectId}
        projectId={projectId}
        lines={lines}
        selectedLine={lines[selected]}
        asset={asset}
      />
    </div>
  );
}

function SourcePanel({
  panel,
  jobs,
  onPanel,
}: {
  panel: Panel;
  jobs: ReturnType<typeof useQuery<JobList, Error>>;
  onPanel: (panel: Panel) => void;
}) {
  const visible = panel === "candidates" || panel === "tasks";
  return (
    <aside
      className={`${styles.panel} ${styles.leftPanel} ${visible ? styles.mobileVisible : styles.mobileHidden}`}
    >
      <div className={styles.panelHeader}>
        <strong>{panel === "tasks" ? "任务" : "候选与任务"}</strong>
      </div>
      <div className={styles.panelTabs}>
        <button
          className={panel === "candidates" ? styles.tabActive : ""}
          onClick={() => onPanel("candidates")}
        >
          候选
        </button>
        <button
          className={panel === "tasks" ? styles.tabActive : ""}
          onClick={() => onPanel("tasks")}
        >
          任务
        </button>
      </div>
      <div className={styles.sideContent}>
        {panel === "tasks" ? (
          <TaskList jobs={jobs} />
        ) : (
          <>
            <div className={styles.sideSectionTitle}>候选来源</div>
            <div className={styles.candidateCard}>
              <strong>暂无候选</strong>
              <small>候选服务尚未连接</small>
            </div>
            <p className={styles.notice}>机器结果需要人工确认后才能应用。</p>
          </>
        )}
      </div>
    </aside>
  );
}

function TaskList({
  jobs,
}: {
  jobs: ReturnType<typeof useQuery<JobList, Error>>;
}) {
  if (jobs.isLoading)
    return <div className={styles.taskCard}>正在读取任务…</div>;
  if (jobs.isError)
    return (
      <div className={styles.taskCard}>
        <span>任务暂时不可用</span>
        <button className={styles.secondary} onClick={() => jobs.refetch()}>
          重试
        </button>
      </div>
    );
  if (!jobs.data?.items.length)
    return <div className={styles.taskCard}>暂无任务</div>;
  const kindLabel: Record<string, string> = { "alignment-preview": "对位预览" };
  const statusLabel: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    succeeded: "已完成",
    failed: "失败",
    interrupted: "已中断",
    cancelled: "已取消",
  };
  return (
    <div className={styles.taskCard}>
      {jobs.data.items.map((job: JobList["items"][number]) => (
        <p key={job.id}>
          <strong>{kindLabel[job.kind] || job.kind}</strong> ·{" "}
          {statusLabel[job.status] || job.status}
          {job.stage ? ` · ${job.stage}` : ""}
          {job.total != null
            ? ` · ${job.completed == null ? "—" : job.completed}/${job.total}`
            : ""}
        </p>
      ))}
    </div>
  );
}

function LineTable({
  lines,
  selected,
  refs,
  onSelect,
  onMove,
}: {
  lines: DocumentShell["lines"];
  selected: number;
  refs: MutableRefObject<Array<HTMLButtonElement | null>>;
  onSelect: (index: number) => void;
  onMove: (index: number, delta: number) => void;
}) {
  if (!lines.length)
    return (
      <div className={styles.emptyLines}>
        <strong>暂无歌词</strong>
        <span>导入歌词功能尚未开放。</span>
      </div>
    );
  return (
    <div className={styles.lineTable} role="listbox" aria-label="歌词行表">
      {lines.map((line, index) => (
        <button
          key={line.id}
          id={line.id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          tabIndex={selected === index ? 0 : -1}
          className={`${styles.lineRow} ${selected === index ? styles.lineSelected : ""}`}
          onClick={() => onSelect(index)}
          onCompositionStart={(event) => {
            event.currentTarget.dataset.composing = "true";
          }}
          onCompositionEnd={(event) => {
            delete event.currentTarget.dataset.composing;
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.currentTarget.dataset.composing
            )
              return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onMove(index, 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onMove(index, -1);
            } else if (event.key === "Home") {
              event.preventDefault();
              onMove(index, -index);
            } else if (event.key === "End") {
              event.preventDefault();
              onMove(index, lines.length - 1 - index);
            }
          }}
          role="option"
          aria-selected={selected === index}
        >
          <span className={styles.lineIndex}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={styles.lineTime}>{time(line.begin_us)}</span>
          <span className={styles.lineText}>{line.text}</span>
          <span className={styles.reviewDot} />
          <span className={styles.agent}>—</span>
        </button>
      ))}
    </div>
  );
}

function Inspector({
  document,
  line,
  visible,
}: {
  document: DocumentShell;
  line: DocumentShell["lines"][number] | undefined;
  visible: boolean;
}) {
  return (
    <aside
      className={`${styles.panel} ${styles.rightPanel} ${visible ? styles.mobileVisible : styles.mobileHidden}`}
    >
      <div className={styles.panelHeader}>
        <strong>行属性</strong>
        <span className={styles.panelHint}>只读</span>
      </div>
      <div className={styles.propertyContent}>
        <div className={styles.propertyLabel}>当前行</div>
        <div className={styles.propertyText}>{line?.text || "—"}</div>
        <dl>
          <div>
            <dt>时间</dt>
            <dd>
              {time(line?.begin_us ?? null)} — {time(line?.end_us ?? null)}
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{document.read_only_reasons[0] || "可查看"}</dd>
          </div>
        </dl>
        <div className={styles.evidence}>
          <strong>数据说明</strong>
          <p>当前为服务返回的只读文档摘要，证据与编辑能力将在后续阶段接入。</p>
        </div>
        <button
          className={styles.secondary}
          disabled
          title="行编辑能力尚未接入"
        >
          编辑当前行
        </button>
      </div>
    </aside>
  );
}
