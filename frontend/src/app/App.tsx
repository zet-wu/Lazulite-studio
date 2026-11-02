import { useMessageText } from '../shared/useMessageText';
import { message, type Message } from '../domain/messages';
import { useTranslation } from 'react-i18next';
import { initializeLanguage, i18n } from '../i18n';
import { DeviceSettings } from '../features/DeviceSettings';
import { loadPreferences, preferences } from '../adapters/preferences';
import { Component, useState, useEffect, type ErrorInfo, type ReactNode } from "react";
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
import { ApiError, studioApi } from "../adapters/http/client";
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
        <h1>{t('app.failure')}</h1>
        <p>{t('app.failureHelp')}</p>
        <button data-role="secondary" onClick={() => location.reload()}>{t('common.reload')}</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function DemoBanner() {
  useTranslation();
  const [params] = useSearchParams();
  const scenario = params.get("scenario");
  const [open, setOpen] = useState(false);
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
      <button data-role="secondary" onClick={() => setOpen(!open)}>{t('app.demo')}</button>
      <span>{t('app.current')}{scenario || t('app.normal')}</span>
      {open && (
        <>
          <button data-role="secondary" onClick={() => pick("")}>{t('app.normal')}</button>
          <button data-role="secondary" onClick={() => pick("loading")}>{t('common.loading')}</button>
          <button data-role="secondary" onClick={() => pick("empty")}>{t('app.empty')}</button>
          <button data-role="secondary" onClick={() => pick("error")}>{t('app.error')}</button>
          <button data-role="secondary" onClick={() => pick("expired")}>{t('app.expired')}</button>
        </>
      )}
    </div>
  );
}

function Login() {
  useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useMessageText("");
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
        caught instanceof ApiError ? caught.body.message : message('login.failed'),
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
        <h1>{t('login.title')}</h1>
        <p>{t('login.help')}</p>
        <form onSubmit={submit}>
          <label>
            {t('login.password')}<input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              disabled={busy}
            />
          </label>
          {error && <p className={styles.loginError}>{error}</p>}
          <button data-role="secondary" className={styles.loginButton} disabled={busy || !password}>
            {busy ? t('login.busy') : t('login.submit')}
          </button>
        </form>
        {import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === "true" ? (
          <button data-role="secondary" className={styles.loginButton} onClick={returnToDemo}>
            {t('app.demoBack')}</button>
        ) : null}
      </div>
    </main>
  );
}
function Settings() {
  useTranslation();
  const query = useQuery({
    queryKey: ["capabilities"],
    queryFn: studioApi.getCapabilities,
  });
  return (
    <main className={styles.simplePage}>
      <Link to="/projects">{t('app.projectsBack')}</Link>
      <h1>{t('menu.settings')}</h1>
      <DeviceSettings/>
      {query.isLoading ? (
        <p>{t('app.capabilitiesLoading')}</p>
      ) : query.isError ? (
        <>
          <p>{t('app.capabilitiesFailed')}</p>
          <button data-role="secondary" onClick={() => query.refetch()}>{t('common.retry')}</button>
        </>
      ) : query.data ? (
        <section>
          {query.data.items.map((item) => (
            <p key={item.id}>
              <strong>{item.id}</strong>：
              {item.enabled ? t('app.enabled') : item.reason || t('app.disabled')}
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function AppRoutes() {
  useTranslation();
  return (
    <div className={styles.appFrame}>
      <DemoBanner />
      <div className={styles.appContent}>
        <Routes>
          <Route path="/editor" element={<Navigate to="/projects" replace />} />
          <Route path="*" element={<ProtectedRoutes />} />
        </Routes>
      </div>
    </div>
  );
}
function ProtectedRoutes() {
  useTranslation();
  return (
    <SessionGate>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/:projectId/edit" element={<WorkspaceRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </SessionGate>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  useTranslation();
  const query = useQuery({
    queryKey: ["session"],
    queryFn: studioApi.getSession,
    retry: false,
  });
  if (query.isLoading)
    return <main className={styles.centerState}>{t('app.sessionLoading')}</main>;
  if (query.error && (query.error as { status?: number }).status === 401)
    return <Login />;
  if (query.error)
    return (
      <main className={styles.centerState}>
        <strong>{t('app.unavailable')}</strong>
        <p>{t('app.sessionFailed')}</p>
        <button data-role="secondary" onClick={() => query.refetch()}>{t('common.retry')}</button>
      </main>
    );
  if (query.data && !query.data.authenticated) return <Login />;
  if (query.data?.mode === "local" && window.location.pathname === "/login") return <Navigate to="/projects" replace />;
  return <PreferenceGate>{children}</PreferenceGate>;
}
function PreferenceGate({ children }: { children: ReactNode }) {
  useTranslation();
  const mock = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === 'true';
  const query = useQuery({ queryKey: ['preferences'], queryFn: async()=>{const value=await loadPreferences();try{await initializeLanguage();}catch{window.dispatchEvent(new CustomEvent('studio-preference-error',{detail:message('language.initFailed')}));}return value;}, enabled: !mock, staleTime: Infinity, retry: false });
  const [error, setError] = useMessageText('');
  useEffect(() => {
    const report = (event: Event) => setError((event as CustomEvent<string|Message>).detail);
    window.addEventListener('studio-preference-error', report);
    return () => window.removeEventListener('studio-preference-error', report);
  }, []);
  if (!mock && query.isPending) return <main className={styles.centerState}>{t('app.preferencesLoading')}</main>;
  if (!mock && query.isError) return <main className={styles.centerState}>{t('app.preferencesFailed')}<button data-role="secondary" onClick={() => query.refetch()}>{t('common.retry')}</button></main>;
  return <>{error && <div role="alert">{error}<button data-role="secondary" onClick={() => location.reload()}>{t('app.preferencesRefresh')}</button></div>}{children}</>;
}
function WorkspaceRoute() {
  useTranslation();
  const { projectId = "sample-project" } = useParams();
  return <Workspace projectId={projectId} />;
}

export default function App() {
  useTranslation();
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

const t=i18n.t.bind(i18n);
