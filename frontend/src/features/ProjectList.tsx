import { useMessageText } from '../shared/useMessageText';
import { message } from '../domain/messages';
import { i18n, formatDate } from '../i18n';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from './LanguageSelector';
import { IconButton } from '../shared/Controls';
import { Select } from '../shared/Select';
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useMemo, useRef, useState } from "react";
import { studioApi } from "../adapters/http/client";
import { clearProjectLocalData, announceProjectDeleted } from "../adapters/project-lifecycle";
import { Icon } from "../shared/Icon";
import { CreateProject } from "./CreateProject";
import styles from "./workspace.module.css";

export function ProjectList() {
  useTranslation();
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => studioApi.listProjects(),
  });
  const archiveInput = useRef<HTMLInputElement>(null);
  const [archiveBusy, setArchiveBusy] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useMessageText('');
  const importControl = <><LanguageSelector/>
    <button data-role="secondary" disabled={!!archiveBusy} onClick={()=>archiveInput.current?.click()}>{archiveBusy==='import'?t('projects.importing'):t('projects.import')}</button>
    <input ref={archiveInput} hidden type="file" accept=".lazp" aria-label={t('projects.archive')} onChange={async event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      setArchiveBusy('import');setArchiveError('');
      try { await studioApi.importProject(file);setExtra([]);setNextCursor(undefined);await query.refetch(); }
      catch(error){setArchiveError(error instanceof Error?error.message:message('projects.importFailed'));}
      finally{setArchiveBusy(null);}
    }}/>
  </>;
  const exportProject = async (id:string,name:string) => {
    setArchiveBusy(id);setArchiveError('');
    try {
      const blob=await studioApi.exportProject(id), url=URL.createObjectURL(blob), link=document.createElement('a');
      link.href=url;link.download=`${name.replace(/[<>:"/\\|?*]/g,'_') || 'project'}.lazp`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error){setArchiveError(error instanceof Error?error.message:message('projects.exportFailed'));}
    finally{setArchiveBusy(null);}
  };
  const location = useLocation();
  const scenario = new URLSearchParams(location.search).get("scenario");
  const withScenario = (path: string) =>
    scenario ? `${path}?scenario=${encodeURIComponent(scenario)}` : path;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [extra, setExtra] = useState<
    Awaited<ReturnType<typeof studioApi.listProjects>>["items"]
  >([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [deleteError, setDeleteError] = useMessageText("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const projects = [...(query.data?.items ?? []), ...extra];
  const visible = useMemo(
    () =>
      projects
        .filter((project) =>
          project.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : b.updated_at.localeCompare(a.updated_at),
        ),
    [projects, search, sort],
  );
  if (query.isLoading)
    return (
      <main className={styles.centerState}>
        <span className={styles.spinner} />
        {t('projects.loading')}</main>
    );
  if (query.isError)
    return (
      <main className={styles.centerState}>
        <strong>{t('projects.unavailable')}</strong>
        <p className={styles.muted}>{t('projects.failedHelp')}</p>
        <button data-role="secondary" className={styles.primary} onClick={() => query.refetch()}>
          {t('common.retry')}</button>
      </main>
    );
  if (!projects.length)
    return (
      <main className={styles.centerState}>
        <strong>{t('projects.empty')}</strong>
        {importControl}
        {archiveError && <p role="alert">{archiveError}</p>}
        <p className={styles.muted}>{t('projects.emptyHelp')}</p>
        <CreateProject
          onCreated={(id) => window.location.assign(`/projects/${id}/edit`)}
        />
      </main>
    );
  return (
    <main className={styles.projectsPage}>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>{t('projects.workspace')}</div>
          <h1>{t('projects.title')}</h1>
          <p className={styles.muted}>{t('projects.description')}</p>
        </div>
        <div className={styles.pageHeadingActions}>
          {importControl}

          <CreateProject
            onCreated={(id) => window.location.assign(`/projects/${id}/edit`)}
          />
        </div>
      </div>
      <div className={styles.projectToolbar}>
        <label className={styles.search}>
          <Icon name="search"/>
          <input
            placeholder={t('projects.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label={t('projects.sort')}
        >
          <option value="recent">{t('projects.recent')}</option>
          <option value="name">{t('projects.name')}</option>
        </Select>
      </div>
      {archiveError && <p role="alert">{archiveError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {visible.length ? (
        <section className={styles.projectList} aria-label={t('projects.list')}>
          {visible.map((project) => (
            <div className={styles.projectRow} key={project.id}>
            <Link to={withScenario(`/projects/${project.id}/edit`)} className={styles.projectMainLink}>
              <div className={styles.projectGlyph}><Icon name="music" size={24}/></div>
              <div className={styles.projectMain}>
                <strong>{project.name}</strong>
                <span>{formatDate(project.updated_at)}</span>
              </div>
              <span className={styles.rowArrow}>›</span>
            </Link>
            <ProjectStorage id={project.id}/>
            <button data-role="secondary" disabled={!!archiveBusy} onClick={()=>void exportProject(project.id,project.name)} aria-label={`导出项目 ${project.name}`}>{archiveBusy===project.id?t('projects.exporting'):t('projects.export')}</button>
            <button data-role="danger" className={`icon-button ${styles.projectDelete}`} aria-label={`删除项目 ${project.name}`} title={`删除项目 ${project.name}`} disabled={deleting === project.id} onClick={async () => {
                if (!window.confirm(`删除项目“${project.name}”？将删除歌词修订、任务和产物。原始上传文件和共享音频保留。`)) return;
                setDeleting(project.id); setDeleteError("");
                try {
                  await studioApi.deleteProject(project.id);
                  announceProjectDeleted(project.id);
                  try { await clearProjectLocalData(project.id); }
                  catch { setDeleteError(message('projects.deleteCleanupFailed')); }
                  setExtra([]); setNextCursor(undefined); await query.refetch();
                } catch (error) { setDeleteError(error instanceof Error ? error.message : message('projects.deleteFailed')); }
                finally { setDeleting(null); }
              }}><Icon name="trash" /></button></div>
          ))}
        </section>
      ) : (
        <div className={styles.centerState}>
          <strong>{t('projects.noMatch')}</strong>
          <p className={styles.muted}>{t('projects.noMatchHelp')}</p>
        </div>
      )}
      {(nextCursor !== undefined ? nextCursor : query.data?.next_cursor) && (
        <button data-role="secondary"
          className={styles.loadMore}
          disabled={loadingMore}
          onClick={async () => {
            const cursor =
              nextCursor !== undefined ? nextCursor : query.data?.next_cursor;
            if (!cursor) return;
            setLoadingMore(true);
            try {
              const page = await studioApi.listProjects(cursor);
              setExtra((items) => [...items, ...page.items]);
              setNextCursor(page.next_cursor);
              setLoadMoreError(false);
            } catch {
              setLoadMoreError(true);
            } finally {
              setLoadingMore(false);
            }
          }}
        >
          {loadMoreError
            ? t('projects.loadRetry')
            : loadingMore
              ? t('projects.loadingMore')
              : t('projects.loadMore')}
        </button>
      )}
    </main>
  );
}

function ProjectStorage({id}:{id:string}) {
  useTranslation();
  const query=useQuery({queryKey:['project-storage',id],queryFn:()=>studioApi.projectStorage(id),staleTime:0,refetchOnMount:'always',refetchInterval:15000});
  const size=(bytes:number)=>bytes>0&&bytes<.01*1024**2?'< 0.01 MiB':bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GiB`:`${(bytes/1024**2).toFixed(2)} MiB`;
  return <div className={styles.projectStorage}>
    <details><summary>{query.isError?t('storage.failed'):query.data?size(query.data.total_bytes):t('storage.loading')}</summary>
      {query.data&&!query.isError&&<dl>{([['source',t('storage.source')],['vocals',t('storage.vocals')],['cache',t('storage.cache')],['snapshots',t('storage.snapshots')],['other',t('storage.other')]] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{size(query.data.categories[key])}</dd></div>)}</dl>}
      <IconButton icon="refresh" label={t('storage.refresh')} data-role="inline" aria-busy={query.isFetching} disabled={query.isFetching} onClick={()=>void query.refetch()}/>
    </details>
  </div>;
}

const t=i18n.t.bind(i18n);
