import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ProjectList } from "../features/ProjectList";
import { Workspace } from "../features/Workspace";
import { LocalEditor } from "../features/editor/LocalEditor";
import { ApiError, studioApi } from "../adapters/http/client";
import { parseStudioTtml } from "../adapters/ttml/codec";
import styles from "./app.module.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Studio UI error", error, info);
  }
  render() {
    return this.state.error ? (
      <div className={styles.errorPage}>
        <h1>页面遇到问题</h1>
        <p>工作区无法继续显示，请重新打开当前页面。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function DemoBanner() {
  const [params] = useSearchParams();
  const scenario = params.get("scenario");
  const [open, setOpen] = useState(false);
  if (window.location.pathname === "/editor") return null;
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS !== "true")
    return null;
  const pick = (value: string) => {
    const next = new URL(window.location.href);
    if (value) next.searchParams.set("scenario", value);
    else next.searchParams.delete("scenario");
    window.location.assign(next.toString());
  };
  return (
    <div className={`${styles.demoBanner} ${open ? styles.demoOpen : ""}`}>
      <button onClick={() => setOpen(!open)}>演示模式 · 合成数据</button>
      <span>当前：{scenario || "正常"}</span>
      {open && (
        <>
          <button onClick={() => pick("")}>正常</button>
          <button onClick={() => pick("loading")}>加载中</button>
          <button onClick={() => pick("empty")}>空项目</button>
          <button onClick={() => pick("error")}>错误</button>
          <button onClick={() => pick("expired")}>会话过期</button>
        </>
      )}
    </div>
  );
}

function Login() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const returnToDemo = () => {
    const next = new URL(window.location.href);
    next.pathname = "/projects";
    next.searchParams.delete("scenario");
    window.location.assign(next.toString());
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await studioApi.login(password);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      if (window.location.pathname === "/login")
        navigate("/projects", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.body.message : "登录失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginLogo}>
          Lazulite <span>Studio</span>
        </div>
        <h1>登录 Lazulite Studio</h1>
        <p>输入服务端密码以继续。</p>
        <form onSubmit={submit}>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              disabled={busy}
            />
          </label>
          {error && <p className={styles.loginError}>{error}</p>}
          <button className={styles.loginButton} disabled={busy || !password}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        {import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === "true" ? (
          <button className={styles.loginButton} onClick={returnToDemo}>
            返回模拟工作台
          </button>
        ) : null}
        <Link to="/editor">打开本地 TTML</Link>
      </div>
    </main>
  );
}
function ExportPage() {
  const { projectId = "" } = useParams();
  const query = useQuery({ queryKey: ["export-document", projectId], queryFn: () => studioApi.getDocument(projectId) });
  const [message, setMessage] = useState("");
  const download = () => {
    if (!query.data) return;
    try {
      const parsed = parseStudioTtml(query.data.document.ttml);
      if (parsed.issues.length) throw new Error(parsed.issues.map((issue) => issue.message).join("；"));
      const blob = new Blob([query.data.document.ttml], { type: "application/ttml+xml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${projectId || "lyrics"}.ttml`; anchor.click();
      URL.revokeObjectURL(url); setMessage("已通过最终校验并开始下载");
    } catch (error) { setMessage(error instanceof Error ? `导出校验失败：${error.message}` : "导出校验失败"); }
  };
  return (
    <main className={styles.simplePage}>
      <Link to="/projects">‹ 返回项目</Link>
      <h1>导出 TTML</h1>
      {query.isLoading ? <p>正在读取富文档…</p> : query.isError ? <p>富文档读取失败，请返回重试。</p> : <><p>下载前会使用编辑器同一套 TTML 校验器检查文档。</p><button onClick={download}>准备导出</button>{message && <p role="status">{message}</p>}</>}
    </main>
  );
}
function Settings() {
  const query = useQuery({
    queryKey: ["capabilities"],
    queryFn: studioApi.getCapabilities,
  });
  return (
    <main className={styles.simplePage}>
      <Link to="/projects">‹ 返回项目</Link>
      <h1>设置</h1>
      {query.isLoading ? (
        <p>正在读取服务能力…</p>
      ) : query.isError ? (
        <>
          <p>服务能力暂时不可用。</p>
          <button onClick={() => query.refetch()}>重试</button>
        </>
      ) : query.data ? (
        <section>
          {query.data.items.map((item) => (
            <p key={item.id}>
              <strong>{item.id}</strong>：
              {item.enabled ? "已启用" : item.reason || "未启用"}
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function AppRoutes() {
  return (
    <div className={styles.appFrame}>
      <DemoBanner />
      <div className={styles.appContent}>
        <Routes>
          <Route path="/editor" element={<LocalEditor />} />
          <Route path="*" element={<ProtectedRoutes />} />
        </Routes>
      </div>
    </div>
  );
}
function ProtectedRoutes() {
  return (
    <SessionGate>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/:projectId/edit" element={<WorkspaceRoute />} />
        <Route path="/projects/:projectId/export" element={<ExportPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </SessionGate>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: studioApi.getSession,
    retry: false,
  });
  if (query.isLoading)
    return <main className={styles.centerState}>正在检查会话…</main>;
  if (query.error && (query.error as { status?: number }).status === 401)
    return <Login />;
  if (query.error)
    return (
      <main className={styles.centerState}>
        <strong>服务暂时不可用</strong>
        <p>会话服务没有响应。</p>
        <button onClick={() => query.refetch()}>重试</button>
        <Link to="/editor">打开本地 TTML</Link>
      </main>
    );
  if (query.data && !query.data.authenticated) return <Login />;
  return children;
}
function WorkspaceRoute() {
  const { projectId = "sample-project" } = useParams();
  return <Workspace projectId={projectId} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
