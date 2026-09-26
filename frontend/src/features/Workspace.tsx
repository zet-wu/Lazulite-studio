import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { studioApi, studioS4, type Asset, type ImportProposal } from '../adapters/http/client';
import type { JobResult } from '../adapters/http/jobs';
import { serializeLyricTtml } from '../adapters/ttml/lyric-codec';
import { detectLyricFormat, exportLyricFile, importLyricFile, type LyricFormat } from '../adapters/lyric-formats';
import { lineText, type LyricLine } from '../domain/lyric-document';
import { CandidatePanel } from './CandidatePanel';
import { JobPanel } from './JobPanel';
import { MediaTransport, type TransportHandle } from './MediaTransport';
import { ReadingDictionaryPanel } from './ReadingDictionaryPanel';
import { ReviewPanel } from './ReviewPanel';
import { JobCandidatePanel } from './JobCandidatePanel';
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editor = useProjectDocument(projectId, initialTtml, initialRevision, undefined,
    async (xml, base, operationId, sequence, etag) => {
      const saved = await studioS4.saveRichDocument(projectId, xml, base, operationId, sequence, etag);
      return { revision: saved.revision, etag: saved.etag };
    });
  const [selectedLineId, setSelectedLineId] = useState<string | null>(params.get('line'));
  const [candidate, setCandidate] = useState<ImportProposal | null>(null);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [tab, setTab] = useState<'import' | 'tasks' | 'dictionary' | 'review'>('import');
  const [message, setMessage] = useState('');
  const [playheadLineId, setPlayheadLineId] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ lineId: string; wordId: string; rubyId: string | null } | null>(null);
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
  const openFile = async (file: File) => {
    if (editor.dirty && !window.confirm('当前修改尚未保存，确定导入其他歌词吗？')) return;
    try {
      const format = detectLyricFormat(file.name);
      if (format === 'ass') throw new Error('ASS 目前仅支持导出');
      editor.apply({ type: 'replace-document', document: importLyricFile(await file.text(), format) });
      setMessage('歌词已导入，请检查后保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败'); }
  };
  const exportFormat = (format: LyricFormat) => {
    try { download(exportLyricFile(editor.document, format), `${title}.${format}`); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '导出失败'); }
  };
  const rubyOptions = (line?.words ?? []).flatMap((word) => {
    return word.rubyUnits.map((unit) => {
      const baseStart = line ? Array.from(line.words.slice(0, line.words.indexOf(word)).map((item) => item.text).join('')).length : 0;
      const item = { id: unit.id, base: word.text, reading: unit.reading, baseStart, baseEnd: baseStart + Array.from(word.text).length };
      return item;
    });
  });
  const auxiliary = <div>
    <h2>项目辅助</h2><div>{(['import', 'tasks', 'dictionary', 'review'] as const).map((value) => <button key={value} onClick={() => setTab(value)}>{({ import: '候选', tasks: '任务', dictionary: '词典', review: '审核' })[value]}</button>)}</div>
    {tab === 'import' && <><label>导入 TTML/LRC/text<input type="file" accept=".ttml,.xml,.lrc,.txt" onChange={(event) => {
      const file = event.target.files?.[0]; if (!file) return;
      void file.text().then((content) => studioS4.importLyrics(projectId, editor.revision, file.name, content)).then(setCandidate).catch((error) => setMessage(error instanceof Error ? error.message : '导入失败'));
      event.target.value = '';
    }} /></label><CandidatePanel proposal={candidate} currentRevision={editor.revision} dirty={editor.dirty} document={editor.document} onApply={(document) => { editor.apply({ type: 'replace-document', document }); setCandidate(null); }} /></>}
    {tab === 'tasks' && <><JobPanel projectId={projectId} revision={editor.revision} assetId={asset?.id ?? null} dirty={editor.dirty} selectedLineIds={line ? [line.id] : []} rubyOptions={rubyOptions} onCandidate={setJobResult} /><JobCandidatePanel result={jobResult} currentRevision={editor.revision} currentAssetId={asset?.id ?? null} dirty={editor.dirty} document={editor.document} onApply={(command) => { try { editor.apply(command); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : '应用候选失败'); } }} /></>}
    {tab === 'dictionary' && <ReadingDictionaryPanel projectId={projectId} />}
    {tab === 'review' && <ReviewPanel projectId={projectId} revision={editor.revision} lineId={line?.id} dirty={editor.dirty} />}
    <button onClick={() => { if (editor.dirty || editor.conflict || editor.saving) setMessage('请先保存后发布'); else navigate(`/projects/${projectId}/export`); }}>发布与下载</button>
    <p>{line ? `当前行：${lineText(line)}` : '无歌词行'}</p>
  </div>;
  return <div className={styles.editorShell}><EditorWorkspace embedded title={title} document={editor.document} apply={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }} undo={editor.undo} redo={editor.redo}
    canUndo={editor.canUndo} canRedo={editor.canRedo} dirty={editor.dirty} saving={editor.saving} error={message || editor.error}
    onSave={() => void editor.save()} onOpen={(file) => void openFile(file)} onDraft={() => exportFile(true)} onFinal={() => exportFile(false)} onExportFormat={exportFormat} auxiliary={auxiliary}
    selectedLineId={selectedLineId} playheadLineId={playheadLineId} transport={transport} onSelectLine={(id) => { setSelectedLineId(id); setParams((current) => { current.set('line', id); return current; }, { replace: true }); }}
    onSelectUnit={(lineId, wordId, rubyId) => setSelectedUnit(wordId ? { lineId, wordId, rubyId } : null)} />
    {editor.recovery.available && <aside>发现本地草稿 <button onClick={() => void editor.restore().catch((error) => setMessage(error.message))}>恢复</button><button onClick={() => void editor.discardRecovery().catch((error) => setMessage(error.message))}>丢弃</button></aside>}
    {editor.conflict && <aside role="alert">服务器已有新版本，本地修改已保留。<button onClick={() => exportFile(true)}>下载本地草稿</button><button onClick={() => { if (window.confirm('重新加载服务器版本并清除本地检查点？')) void editor.discardRecovery().then(() => window.location.reload()); }}>重新加载服务器</button></aside>}
    <MediaTransport ref={transport} projectId={projectId} selectedLine={line ? { begin_us: line.beginUs, end_us: line.endUs } : undefined} loopRange={unitRange} asset={asset}
      document={editor.document} selectedLineId={line?.id ?? null} onTimelineCommand={(command) => { if (!editor.apply(command)) throw new Error('保存冲突，请先处理'); }}
      onSelectLine={(id) => { setSelectedLineId(id); setSelectedUnit(null); setParams((current) => { current.set('line', id); return current; }, { replace: true }); }}
      onPosition={(positionUs) => {
        const active = editor.document.lines.find((item) => !item.backgroundOf && item.beginUs !== null && item.endUs !== null && item.beginUs <= positionUs && positionUs < item.endUs)?.id ?? null;
        setPlayheadLineId((current) => current === active ? current : active);
      }} /></div>;
}
