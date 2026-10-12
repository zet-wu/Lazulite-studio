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
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => studioApi.listProjects(),
  });
  const archiveInput = useRef<HTMLInputElement>(null);
  const [archiveBusy, setArchiveBusy] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const importControl = <>
    <button data-role="secondary" disabled={!!archiveBusy} onClick={()=>archiveInput.current?.click()}>{archiveBusy==='import'?'正在导入…':'导入项目'}</button>
    <input ref={archiveInput} hidden type="file" accept=".lazp" aria-label="Lazulite Studio 工程（*.lazp）" onChange={async event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      setArchiveBusy('import');setArchiveError('');
      try { await studioApi.importProject(file);setExtra([]);setNextCursor(undefined);await query.refetch(); }
      catch(error){setArchiveError(error instanceof Error?error.message:'导入失败');}
      finally{setArchiveBusy(null);}
    }}/>
  </>;
  const exportProject = async (id:string,name:string) => {
    setArchiveBusy(id);setArchiveError('');
    try {
      const blob=await studioApi.exportProject(id), url=URL.createObjectURL(blob), link=document.createElement('a');
      link.href=url;link.download=`${name.replace(/[<>:"/\\|?*]/g,'_') || 'project'}.lazp`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error){setArchiveError(error instanceof Error?error.message:'导出失败');}
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
  const [deleteError, setDeleteError] = useState("");
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
        正在加载项目…
      </main>
    );
  if (query.isError)
    return (
      <main className={styles.centerState}>
        <strong>项目暂时不可用</strong>
        <p className={styles.muted}>服务没有返回项目列表。</p>
        <button data-role="secondary" className={styles.primary} onClick={() => query.refetch()}>
          重试
        </button>
      </main>
    );
  if (!projects.length)
    return (
      <main className={styles.centerState}>
        <strong>还没有项目</strong>
        {importControl}
        {archiveError && <p role="alert">{archiveError}</p>}
        <p className={styles.muted}>创建项目开始制作歌词，音乐可稍后上传。</p>
        <CreateProject
          onCreated={(id) => window.location.assign(`/projects/${id}/edit`)}
        />
      </main>
    );
  return (
    <main className={styles.projectsPage}>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>工作台</div>
          <h1>项目</h1>
          <p className={styles.muted}>管理歌曲与歌词项目</p>
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
            placeholder="搜索项目"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="排序"
        >
          <option value="recent">最近编辑</option>
          <option value="name">名称</option>
        </Select>
      </div>
      {archiveError && <p role="alert">{archiveError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {visible.length ? (
        <section className={styles.projectList} aria-label="项目列表">
          {visible.map((project) => (
            <div className={styles.projectRow} key={project.id}>
            <Link to={withScenario(`/projects/${project.id}/edit`)} className={styles.projectMainLink}>
              <div className={styles.projectGlyph}><Icon name="music" size={24}/></div>
              <div className={styles.projectMain}>
                <strong>{project.name}</strong>
                <span>{new Date(project.updated_at).toLocaleDateString("zh-CN")}</span>
              </div>
              <span className={styles.rowArrow}>›</span>
            </Link>
            <ProjectStorage id={project.id}/>
            <button data-role="secondary" disabled={!!archiveBusy} onClick={()=>void exportProject(project.id,project.name)} aria-label={`导出项目 ${project.name}`}>{archiveBusy===project.id?'正在导出…':'导出项目'}</button>
            <button data-role="danger" className={`icon-button ${styles.projectDelete}`} aria-label={`删除项目 ${project.name}`} title={`删除项目 ${project.name}`} disabled={deleting === project.id} onClick={async () => {
                if (!window.confirm(`删除项目“${project.name}”？将删除歌词修订、任务和产物。原始上传文件和共享音频保留。`)) return;
                setDeleting(project.id); setDeleteError("");
                try {
                  await studioApi.deleteProject(project.id);
                  announceProjectDeleted(project.id);
                  try { await clearProjectLocalData(project.id); }
                  catch { setDeleteError("项目已删除，本地恢复数据清理失败。重新打开也无法保存到已删除项目。"); }
                  setExtra([]); setNextCursor(undefined); await query.refetch();
                } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请重试"); }
                finally { setDeleting(null); }
              }}><Icon name="trash" /></button></div>
          ))}
        </section>
      ) : (
        <div className={styles.centerState}>
          <strong>没有匹配项目</strong>
          <p className={styles.muted}>换一个名称或清空搜索条件。</p>
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
            ? "加载失败，重试"
            : loadingMore
              ? "正在加载…"
              : "加载更多"}
        </button>
      )}
    </main>
  );
}

function ProjectStorage({id}:{id:string}) {
  const query=useQuery({queryKey:['project-storage',id],queryFn:()=>studioApi.projectStorage(id),staleTime:0,refetchOnMount:'always',refetchInterval:15000});
  const size=(bytes:number)=>bytes>0&&bytes<.01*1024**2?'< 0.01 MiB':bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GiB`:`${(bytes/1024**2).toFixed(2)} MiB`;
  return <div className={styles.projectStorage}>
    <details><summary>{query.isError?'统计失败':query.data?size(query.data.total_bytes):'正在统计…'}</summary>
      {query.data&&!query.isError&&<dl>{([['source','源音频'],['vocals','人声结果'],['cache','可重建缓存'],['snapshots','项目快照'],['other','其他文件']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{size(query.data.categories[key])}</dd></div>)}</dl>}
      <IconButton icon="refresh" label="刷新空间统计" data-role="inline" aria-busy={query.isFetching} disabled={query.isFetching} onClick={()=>void query.refetch()}/>
    </details>
  </div>;
}
