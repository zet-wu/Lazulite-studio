import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { studioApi, studioS4, type Asset } from '../adapters/http/client';
import { serializeLyricTtml } from '../adapters/ttml/lyric-codec';
import { exportLyricFile, type LyricFormat } from '../adapters/lyric-formats';
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
  if (envelope.isError || !envelope.data) return <main><p role="alert">无法打开项目文档</p><button onClick={() => void envelope.refetch()}>重试</button></main>;
  return <ProjectEditor key={`${projectId}:${envelope.data.revision}`} projectId={projectId} title={project.data?.name ?? '歌词项目'} initialTtml={envelope.data.document.ttml}
    initialRevision={envelope.data.revision ?? ''} asset={project.data?.asset ?? null} />;
}

function ProjectEditor({ projectId, title, initialTtml, initialRevision, asset }: { projectId: string; title: string; initialTtml: string; initialRevision: string; asset: Asset | null }) {
  const transport = useRef<TransportHandle>(null);
  const [params, setParams] = useSearchParams();
  const editor = useProjectDocument(projectId, initialTtml, initialRevision, undefined,
    async (xml, base, operationId, sequence, etag) => {
      const saved = await studioS4.saveRichDocument(projectId, xml, base, operationId, sequence, etag);
      return { revision: saved.revision, etag: saved.etag };
    });
  const [selectedLineId, setSelectedLineId] = useState<string | null>(params.get('line'));
  const [message, setMessage] = useState('');
  const [playheadLineId, setPlayheadLineId] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ lineId: string; wordId: string; rubyId: string | null } | null>(null);
  const [selectedRomanization, setSelectedRomanization] = useState<{ trackId: string; contentId: string } | null>(null);
  const line: LyricLine | undefined = editor.document.lines.find((item) => item.id === selectedLineId) ?? editor.document.lines[0];
  const unitLine = editor.document.lines.find((item) => item.id === selectedUnit?.lineId);
  const unitWord = unitLine?.words.find((item) => item.id === selectedUnit?.wordId);
  const unitRuby = unitWord?.rubyUnits.find((item) => item.id === selectedUnit?.rubyId);
  const unitBegin = unitRuby?.beginUs ?? unitWord?.beginUs;
  const unitEnd = unitRuby?.endUs ?? unitWord?.endUs;
  const unitRange = unitBegin != null && unitEnd != null ? { begin_us: unitBegin, end_us: unitEnd } : undefined;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editor.dirty || editor.saving || editor.conflict) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor.dirty, editor.saving, editor.conflict]);
  const exportFile = (draft: boolean) => {
    try { download(serializeLyricTtml(editor.document, { draft }), `${title}${draft ? '.draft' : ''}.ttml`); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '导出失败'); }
  };
  const exportFormat = (format: LyricFormat) => {
    try { download(exportLyricFile(editor.document, format), `${title}.${format === 'elrc' ? 'extended.lrc' : format}`); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '导出失败'); }
  };
  return <div className={styles.editorShell}><EditorWorkspace embedded projectId={projectId} title={title} document={editor.document} apply={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }} undo={editor.undo} redo={editor.redo}
    canUndo={editor.canUndo} canRedo={editor.canRedo} dirty={editor.dirty} saving={editor.saving} error={message || editor.error}
    onSave={() => void editor.save()} onDraft={() => exportFile(true)} onFinal={() => exportFile(false)} onExportFormat={exportFormat}
    saveForPackaging={editor.saveForPackaging}
    selectedLineId={selectedLineId} playheadLineId={playheadLineId} transport={transport} onSelectLine={(id) => { setSelectedLineId(id); setSelectedUnit(null); setSelectedRomanization(null); setParams((current) => { current.set('line', id); return current; }, { replace: true }); }}
    onSelectRomanization={(trackId, contentId) => setSelectedRomanization({ trackId, contentId })}
    onSelectUnit={(lineId, wordId, rubyId) => setSelectedUnit(wordId ? { lineId, wordId, rubyId } : null)} />
    {editor.recovery.available && <aside>发现本地草稿 <button onClick={() => void editor.restore().catch((error) => setMessage(error.message))}>恢复</button><button onClick={() => void editor.discardRecovery().catch((error) => setMessage(error.message))}>丢弃</button></aside>}
    {editor.conflict && <aside role="alert">服务器已有新版本，本地修改已保留。<button onClick={() => exportFile(true)}>下载本地草稿</button><button onClick={() => { if (window.confirm('重新加载服务器版本并清除本地检查点？')) void editor.discardRecovery().then(() => window.location.reload()); }}>重新加载服务器</button></aside>}
    <MediaTransport ref={transport} projectId={projectId} selectedLine={line ? { begin_us: line.beginUs, end_us: line.endUs } : undefined} loopRange={unitRange} asset={asset}
      document={editor.document} selectedLineId={line?.id ?? null} selectedRomanization={selectedRomanization} onTimelineCommand={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }}
      onSelectLine={(id) => { setSelectedLineId(id); setSelectedUnit(null); setSelectedRomanization(null); setParams((current) => { current.set('line', id); return current; }, { replace: true }); }}
      onPosition={(positionUs) => {
        const active = editor.document.lines.find((item) => !item.backgroundOf && item.beginUs !== null && item.endUs !== null && item.beginUs <= positionUs && positionUs < item.endUs)?.id ?? null;
        setPlayheadLineId((current) => current === active ? current : active);
      }} /></div>;
}
