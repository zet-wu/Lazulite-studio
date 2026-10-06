import { ProjectEditingContext } from './editor/ProjectEditingContext';
import { selectionLineId } from './editor/editing-actions';
import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { AudioReviewProvider, useAudioReview } from './AudioReviewContext';
import { assignVocalSegmentCommand, AssignmentError } from '../domain/vocal-editing';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { studioApi, studioS4, type Asset } from '../adapters/http/client';
import { DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { exportLyricFile, type LyricFormat } from '../adapters/lyric-formats';
import type { ProjectSnapshot } from '../domain/project-document';
import type { LyricLine } from '../domain/lyric-document';
import { MediaTransport, type TransportHandle } from './MediaTransport';
import { EditorWorkspace } from './editor/EditorWorkspace';
import { useProjectDocument } from './useProjectDocument';
import styles from './workspace.module.css';

function download(xml: string, name: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: name.endsWith('.ttml') ? 'application/ttml+xml' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workspace({ projectId }: { projectId: string }) {
  const envelope = useQuery({ queryKey: ['document-envelope', projectId], queryFn: () => studioS4.getDocumentEnvelope(projectId), refetchOnMount: 'always', refetchOnWindowFocus: false });
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => studioApi.getProject(projectId) });
  if (envelope.isLoading || envelope.isFetching) return <main>正在加载歌词…</main>;
  if (envelope.isError || !envelope.data) return <main><p role="alert">{(envelope.error as {status?:number})?.status === 404 ? '项目不存在或已删除' : '无法打开项目文档'}</p><button data-role="secondary" onClick={() => void envelope.refetch()}>重试</button></main>;
  return <SelectionProvider><AudioReviewProvider><ProjectEditor key={`${projectId}:${envelope.data.revision}`} projectId={projectId} title={project.data?.name ?? '歌词项目'} initialSnapshot={envelope.data.document}
    initialRevision={envelope.data.revision ?? ''} asset={project.data?.asset ?? null} /></AudioReviewProvider></SelectionProvider>;
}

function ProjectEditor({ projectId, title, initialSnapshot, initialRevision, asset }: { projectId: string; title: string; initialSnapshot: ProjectSnapshot; initialRevision: string; asset: Asset | null }) {
  const audioReview=useAudioReview();
  const transport = useRef<TransportHandle>(null);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [assignmentError, setAssignmentError] = useState<AssignmentError | null>(null);
  const [params, setParams] = useSearchParams();
  const editor = useProjectDocument(projectId, initialSnapshot, initialRevision, undefined,
    async (xml, base, operationId, sequence, etag) => {
      const saved = await studioS4.saveRichDocument(projectId, xml, base, operationId, sequence, etag);
      return { revision: saved.revision, etag: saved.etag };
    });
  const { selection, expanded } = useEditorSelection()!;
  const selectedLineId = selectionLineId(selection) ?? expanded.at(-1) ?? params.get('line');
  const [message, setMessage] = useState('');
  const [outputIssues,setOutputIssues] = useState<OutputIssue[]>([]);
  const [playheadLineId, setPlayheadLineId] = useState<string | null>(null);
  const line = editor.document.lines.find(item => item.id === selectedLineId) ?? editor.document.lines[0];
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editor.dirty || editor.saving || editor.conflict) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor.dirty, editor.saving, editor.conflict]);
  if (editor.deleted) return <main><p role="alert">项目已删除，不能继续保存或恢复。</p><a href="/projects">返回项目列表</a></main>;
  const exportFormat = (format: LyricFormat) => {
    download(exportLyricFile(editor.document, format, editor.project.editing), `${title}.${format === 'elrc' ? 'extended.lrc' : format}`);
  };
  return <ProjectEditingContext value={editor.project.editing}><div className={styles.editorShell} onKeyDown={event=>{
    if(event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || !(event.ctrlKey||event.metaKey) || (event.target as Element).closest('input,textarea,select,[role="dialog"]'))return;
    if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)editor.redo();else editor.undo();}
    if(event.key.toLowerCase()==='s'){event.preventDefault();void editor.save();}
  }}><EditorWorkspace historyVersion={editor.historyVersion} project={editor.project} applyProject={command=>{if(editor.conflict)throw new Error('保存冲突，请先处理');editor.applyProject(command);}} audioDurationMs={asset?.duration_ms ?? 0} onTimelineHost={setTimelineHost} assignmentError={assignmentError} embedded projectId={projectId} title={title} document={editor.document} apply={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }} undo={editor.undo} redo={editor.redo}
    canUndo={editor.canUndo} canRedo={editor.canRedo} dirty={editor.dirty} saving={editor.saving} outputIssues={outputIssues} error={message || editor.error}
    onSave={() => void editor.save()} onExportFormat={exportFormat}
    saveForPackaging={editor.saveForPackaging}
    selectedLineId={selectedLineId} playheadLineId={playheadLineId} transport={transport} />
    {editor.recovery.available && <aside>发现本地草稿 <button data-role="secondary" onClick={() => void editor.restore().catch((error) => setMessage(error.message))}>恢复</button><button data-role="secondary" onClick={() => void editor.discardRecovery().catch((error) => setMessage(error.message))}>丢弃</button></aside>}
    {editor.conflict && <aside role="alert">服务器已有新版本，本地修改已保留。<button data-role="secondary" onClick={() => { setOutputIssues([]); try { exportFormat('ttml'); } catch(e) { if(e instanceof DocumentOutputError)setOutputIssues(e.issues); else setMessage(e instanceof Error ? e.message : '下载失败'); } }}>下载本地 TTML</button>{outputIssues.length>0 && <p>有 {outputIssues.length} 项需要处理，请到文件打包查看定位列表。</p>}<button data-role="secondary" onClick={() => { if (window.confirm('重新加载服务器版本并清除本地检查点？')) void editor.discardRecovery().then(() => window.location.reload()); }}>重新加载服务器</button></aside>}
    <MediaTransport timelineHost={timelineHost} acoustics={editor.project.acoustics} onAcoustics={acoustics=>{if(editor.conflict)throw new Error('保存冲突，请先处理');editor.applyProject({type:'acoustics',acoustics,durationMs:asset?.duration_ms??0});}} onAssign={(lineId,segment)=>{
      try { if(!editor.apply(assignVocalSegmentCommand(editor.project,lineId,segment,asset?.duration_ms??0)))throw new Error('保存冲突，请先处理');setAssignmentError(null); }
      catch(e){if(e instanceof AssignmentError)setAssignmentError(e);throw e;}
    }} ref={transport} projectId={projectId} selectedLine={line ? { begin_ms: line.beginMs, end_ms: line.endMs } : undefined} asset={asset}
      document={editor.document} selectedLineId={line?.id ?? null} onTimelineCommand={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }}
      onPosition={(positionMs) => {
        const active = editor.document.lines.find((item) => !item.backgroundOf && item.beginMs !== null && item.endMs !== null && item.beginMs <= positionMs && positionMs < item.endMs)?.id ?? null;
        setPlayheadLineId((current) => current === active ? current : active);
      }} /></div></ProjectEditingContext>;
}
