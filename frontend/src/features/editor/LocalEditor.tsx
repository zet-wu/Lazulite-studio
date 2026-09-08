import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { createRecoveryAdapter } from "../../adapters/recovery";
import {
  createStudioDocument,
  parseStudioTtml,
  serializeStudioTtml,
} from "../../adapters/ttml";
import {
  canRedo,
  canUndo,
  createEditorState,
  executeCommand,
  redo,
  undo,
  type EditorState,
} from "../../domain/editing";
import type { StudioLine } from "../../domain/document";
import styles from "./editor.module.css";

type View = "structure" | "lines" | "properties";
const toSeconds = (us: number | null) =>
  us == null ? "" : String(us / 1_000_000);
const displayTime = (us: number | null) =>
  us == null ? "—" : `${us / 1_000_000}s`;
const identity = (value: unknown) => JSON.stringify(value);
function parseSeconds(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim()))
    throw new Error("时间必须是非负秒数");
  const micros = Number(value) * 1_000_000;
  if (!Number.isSafeInteger(Math.round(micros)))
    throw new Error("时间超出微秒精度范围");
  return Math.round(micros);
}

function Toolbar(props: {
  state: EditorState;
  name: string;
  dirty: boolean;
  saving: boolean;
  onOpen: () => void;
  onNew: () => void;
  onCheckpoint: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDraft: () => void;
  onOriginal: () => void;
  onFinal: () => void;
}) {
  return (
    <header className={styles.top}>
      <Link
        className={styles.brand}
        to="/projects"
        onClick={(event) => {
          if (props.dirty && !window.confirm("当前修改尚未保存，确定离开吗？"))
            event.preventDefault();
        }}
      >
        Lazulite <span>Studio</span>
      </Link>
      <span className={styles.fileName}>{props.name}</span>
      <span className={styles.status}>
        {props.dirty ? "● 未保存" : "✓ 未修改"}
      </span>
      <div className={styles.actions}>
        <button
          className={styles.button}
          onClick={props.onOpen}
          disabled={props.saving}
        >
          打开
        </button>
        <button
          className={styles.button}
          onClick={props.onNew}
          disabled={props.saving}
        >
          新建
        </button>
        <button
          className={styles.button}
          onClick={props.onCheckpoint}
          disabled={props.saving}
        >
          {props.saving ? "正在保存…" : "保存检查点"}
        </button>
        <button
          className={styles.button}
          onClick={props.onUndo}
          disabled={!canUndo(props.state)}
        >
          撤销
        </button>
        <button
          className={styles.button}
          onClick={props.onRedo}
          disabled={!canRedo(props.state)}
        >
          重做
        </button>
        <button className={styles.button} onClick={props.onDraft}>
          下载草稿
        </button>
        <button className={styles.button} onClick={props.onOriginal}>
          下载原件
        </button>
        <button
          className={`${styles.button} ${styles.primary}`}
          onClick={props.onFinal}
        >
          最终 TTML
        </button>
      </div>
    </header>
  );
}

function Lines({
  lines,
  selected,
  onSelect,
}: {
  lines: StudioLine[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const keyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelect(Math.min(lines.length - 1, selected + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelect(Math.max(0, selected - 1));
    }
  };
  return (
    <main className={styles.panel + " " + styles.tablePanel}>
      <div className={styles.tableHeader}>
        <h1>歌词行表</h1>
        <span className={styles.status}>
          {lines.length
            ? `${lines.length} 行 · 选中 ${selected + 1}`
            : "暂无歌词行"}
        </span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>正文</th>
            <th>开始</th>
            <th>结束</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={line.id}
              data-line-index={index}
              tabIndex={0}
              className={`${styles.tableRow} ${selected === index ? styles.tableRowSelected : ""}`}
              onClick={() => onSelect(index)}
              onKeyDown={keyDown}
            >
              <td className={styles.mono}>{index + 1}</td>
              <td>
                <span className={styles.lineText}>
                  {line.text || <span className={styles.status}>空行</span>}
                </span>
              </td>
              <td className={styles.mono}>{displayTime(line.beginUs)}</td>
              <td className={styles.mono}>{displayTime(line.endUs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function LocalEditor() {
  const [initial] = useState(() => createStudioDocument());
  const [state, setState] = useState(() => createEditorState(initial));
  const [cleanKey, setCleanKey] = useState(() => identity(initial));
  const [name, setName] = useState("未命名.ttml");
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>("lines");
  const [text, setText] = useState("");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const interacted = useRef(false);
  const document = state.present.document;
  const line = document.lines[selected];
  const formDirty = Boolean(
    line &&
      (text !== line.text ||
        begin !== toSeconds(line.beginUs) ||
        end !== toSeconds(line.endUs)),
  );
  const dirty = identity(document) !== cleanKey || formDirty;
  const resetForm = (nextLine: StudioLine | undefined) => {
    setText(nextLine?.text ?? "");
    setBegin(toSeconds(nextLine?.beginUs ?? null));
    setEnd(toSeconds(nextLine?.endUs ?? null));
  };

  useEffect(() => {
    setText(line?.text ?? "");
    setBegin(toSeconds(line?.beginUs ?? null));
    setEnd(toSeconds(line?.endUs ?? null));
  }, [line?.id, line?.text, line?.beginUs, line?.endUs]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    void createRecoveryAdapter()
      .readCheckpoint("local")
      .then((record) => {
        if (!record || interacted.current) return;
        if (window.confirm("发现本地检查点，是否恢复？取消将丢弃它。")) {
          setState(record.state);
          setCleanKey(identity(record.state.present.document));
          setName("恢复的草稿.ttml");
          setMessage("已恢复本地检查点（含最近撤销历史）");
        } else
          void createRecoveryAdapter()
            .clear("local")
            .catch(() => setMessage("丢弃本地检查点失败"));
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "读取本地检查点失败",
        ),
      );
  }, []);

  const move = (next: EditorState) => setState(next);
  const undoEdit = () => {
    if (formDirty && !window.confirm("当前行表单尚未应用，确定撤销吗？"))
      return;
    const next = undo(state);
    move(next);
    resetForm(next.present.document.lines[selected]);
  };
  const redoEdit = () => {
    if (formDirty && !window.confirm("当前行表单尚未应用，确定重做吗？"))
      return;
    const next = redo(state);
    move(next);
    resetForm(next.present.document.lines[selected]);
  };
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z" ||
        event.isComposing
      )
        return;
      const target = event.target as HTMLElement;
      if (target.matches("textarea,input,select,[contenteditable=true]"))
        return;
      event.preventDefault();
      event.shiftKey ? redoEdit() : undoEdit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const choose = (index: number) => {
    if (index === selected) return;
    if (formDirty && !window.confirm("当前行表单尚未应用，确定切换吗？"))
      return;
    setSelected(index);
    resetForm(document.lines[index]);
    window.document
      .querySelector<HTMLElement>(`[data-line-index="${index}"]`)
      ?.focus();
  };
  const apply = () => {
    if (!line) return;
    try {
      const changes: {
        text?: string;
        beginUs?: number | null;
        endUs?: number | null;
      } = {};
      if (text !== line.text) changes.text = text;
      if (begin !== toSeconds(line.beginUs))
        changes.beginUs = parseSeconds(begin);
      if (end !== toSeconds(line.endUs)) changes.endUs = parseSeconds(end);
      if (Object.keys(changes).length)
        setState(
          executeCommand(state, {
            type: "update-line",
            lineId: line.id,
            changes,
          }),
        );
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改无法应用");
    }
  };
  const replaceWith = async (file: File) => {
    interacted.current = true;
    if (dirty && !window.confirm("当前修改尚未保存，确定替换文件吗？")) return;
    try {
      const next = parseStudioTtml(await file.text());
      setState(createEditorState(next));
      setCleanKey(identity(next));
      setName(file.name);
      setSelected(0);
      resetForm(next.lines[0]);
      setMessage(null);
    } catch (error) {
      setMessage(
        `导入失败：${error instanceof Error ? error.message : "无效 TTML"}`,
      );
    }
  };
  const newFile = () => {
    interacted.current = true;
    if (dirty && !window.confirm("当前修改尚未保存，确定新建吗？")) return;
    const next = createStudioDocument();
    setState(createEditorState(next));
    setCleanKey(identity(next));
    setName("未命名.ttml");
    setSelected(0);
    resetForm(next.lines[0]);
    setMessage(null);
  };
  const saveCheckpoint = async () => {
    if (formDirty) {
      setMessage("请先应用当前行修改");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await createRecoveryAdapter().save("local", document.rawXml, state);
      setCleanKey(identity(document));
      setMessage("本地检查点已保存");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `保存检查点失败：${error.message}`
          : "保存检查点失败",
      );
    } finally {
      setSaving(false);
    }
  };
  const download = (xml: string) => {
    const url = URL.createObjectURL(
      new Blob([xml], { type: "application/ttml+xml" }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = name || "draft.ttml";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const draft = () => {
    if (formDirty) {
      setMessage("请先应用当前行修改");
      return;
    }
    try {
      download(serializeStudioTtml(document, { draft: true }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    }
  };
  const original = () => download(document.baseline.xml);
  const final = () => {
    if (formDirty) {
      setMessage("请先应用当前行修改");
      return;
    }
    try {
      download(serializeStudioTtml(document));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "最终 TTML 校验失败");
    }
  };
  const markInput = (setter: (value: string) => void, value: string) => {
    interacted.current = true;
    setter(value);
  };

  return (
    <div className={styles.page}>
      <Toolbar
        state={state}
        name={name}
        dirty={dirty}
        saving={saving}
        onOpen={() => fileInput.current?.click()}
        onNew={newFile}
        onCheckpoint={() => void saveCheckpoint()}
        onUndo={undoEdit}
        onRedo={redoEdit}
        onDraft={draft}
        onOriginal={original}
        onFinal={final}
      />
      {message && (
        <div role="status" className={styles.issue}>
          {message}
        </div>
      )}
      <input
        ref={fileInput}
        className={styles.fileInput}
        type="file"
        accept=".ttml,.xml,application/xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void replaceWith(file);
          event.currentTarget.value = "";
        }}
      />
      <nav className={styles.mobileTabs}>
        {(["structure", "lines", "properties"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? styles.active : ""}
            onClick={() => setView(item)}
          >
            {item === "structure" ? "结构" : item === "lines" ? "行表" : "属性"}
          </button>
        ))}
      </nav>
      <div className={styles.body}>
        <aside
          className={`${styles.panel} ${view !== "structure" ? styles.hidden : ""}`}
        >
          <h2 className={styles.panelTitle}>文档结构</h2>
          <div className={styles.readonly}>
            TTML · {document.lines.length} 行<br />
            原始 XML 保留，未知节点只读
          </div>
          <div className={styles.diagnostics}>
            <h2 className={styles.panelTitle}>诊断</h2>
            {document.issues.length ? (
              document.issues.map((issue, index) => (
                <div className={styles.issue} key={`${issue.code}-${index}`}>
                  {issue.message}
                </div>
              ))
            ) : (
              <div className={styles.readonly}>没有诊断问题</div>
            )}
          </div>
        </aside>
        <div className={view !== "lines" ? styles.hidden : ""}>
          <Lines lines={document.lines} selected={selected} onSelect={choose} />
        </div>
        <aside
          className={`${styles.panel} ${view !== "properties" ? styles.hidden : ""}`}
        >
          <h2 className={styles.panelTitle}>当前行属性</h2>
          {line ? (
            <>
              <div className={styles.field}>
                <label htmlFor="line-text">正文</label>
                <textarea
                  id="line-text"
                  className={styles.textarea}
                  value={text}
                  disabled={!line.editable.text}
                  onChange={(event) => markInput(setText, event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="line-begin">开始（秒）</label>
                <input
                  id="line-begin"
                  value={begin}
                  disabled={!line.editable.timing}
                  onChange={(event) => markInput(setBegin, event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="line-end">结束（秒）</label>
                <input
                  id="line-end"
                  value={end}
                  disabled={!line.editable.timing}
                  onChange={(event) => markInput(setEnd, event.target.value)}
                />
              </div>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={apply}
              >
                应用修改
              </button>
              {!line.editable.text && (
                <div className={styles.readonly}>
                  正文只读：{line.locks.text}
                </div>
              )}
              {!line.editable.timing && (
                <div className={styles.readonly}>
                  时间只读：{line.locks.timing}
                </div>
              )}
              {line.ruby.length > 0 && (
                <div className={styles.readonly}>
                  Ruby 已保留：
                  {line.ruby
                    .map((ruby) => `${ruby.base} → ${ruby.reading}`)
                    .join("、")}
                </div>
              )}
            </>
          ) : (
            <div className={styles.readonly}>请选择一行</div>
          )}
        </aside>
      </div>
    </div>
  );
}
