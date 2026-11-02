import { errorMessage, message as describeMessage, MessageError } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { announceSourceChanged, listenSourceChanged } from '../adapters/project-lifecycle';
import { scopedSessionKey } from '../adapters/preferences';
import { KaraokeContext } from './KaraokeContext';
import { useNotice } from '../shared/MessageBar';
import { ProjectEditingContext } from './editor/ProjectEditingContext';
import { selectionLineId } from './editor/editing-actions';
import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { AudioReviewProvider } from './AudioReviewContext';
import { assignVocalSegmentCommand, AssignmentError } from '../domain/vocal-editing';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { studioApi, studioS4, type Asset } from '../adapters/http/client';
import { DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { exportLyricFile, type LyricFormat } from '../adapters/lyric-formats';
import type { ProjectSnapshot } from '../domain/project-document';
import type { LyricLine } from '../domain/lyric-document';
import { MediaTransport, type TransportHandle } from './MediaTransport';
import { EditorWorkspace } from './editor/EditorWorkspace';
import { useProjectDocument } from './useProjectDocument';
import { MusicUpload } from './MusicUpload';
import styles from './workspace.module.css';

function download(xml: string, name: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: name.endsWith('.ttml') ? 'application/ttml+xml' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workspace({ projectId }: { projectId: string }) {
  useTranslation();
  const [cleanupError,setCleanupError]=useMessageText('');
  const envelope = useQuery({ queryKey: ['document-envelope', projectId], queryFn: () => studioS4.getDocumentEnvelope(projectId), refetchOnMount: 'always', refetchOnWindowFocus: false });
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => studioApi.getProject(projectId) });
  const paired=useRef(false);
  const mismatch=!!envelope.data&&!!project.data&&envelope.data.source_asset_id!==(project.data.asset?.id??null);
  useEffect(()=>{if(mismatch&&!paired.current){void envelope.refetch();void project.refetch();}},[mismatch]);
  if(envelope.data&&project.data&&!mismatch)paired.current=true;
  if(!paired.current&&mismatch)return <main>{t('workspace.sourceChanging')}</main>;
  if (envelope.isLoading || project.isLoading) return <main>{t('workspace.loading')}</main>;
  if (envelope.isError || !envelope.data) return <main><p role="alert">{(envelope.error as {status?:number})?.status === 404 ? t('workspace.missing') : t('workspace.openFailed')}</p><button data-role="secondary" onClick={() => void envelope.refetch()}>{t('common.retry')}</button></main>;
  return <SelectionProvider><AudioReviewProvider>{project.data?.music_cleanup_pending&&<aside role="alert">{t('workspace.cleanupPending')}<button data-role="secondary" onClick={()=>void studioApi.cleanupMusic(projectId).then(()=>project.refetch()).catch(cause=>setCleanupError(errorMessage(cause)))}>{t('music.cleanupRetry')}</button>{cleanupError}</aside>}<ProjectEditor key={projectId} projectId={projectId} title={project.data?.name ?? t('workspace.defaultName')} initialSnapshot={envelope.data.document}
    initialRevision={envelope.data.revision ?? ''} asset={project.data?.asset ?? null} /></AudioReviewProvider></SelectionProvider>;
}

function ProjectEditor({ projectId, title, initialSnapshot, initialRevision, asset }: { projectId: string; title: string; initialSnapshot: ProjectSnapshot; initialRevision: string; asset: Asset | null }) {
  useTranslation();
  const transport = useRef<TransportHandle>(null);
  const prepareAudioImport=useRef<(()=>boolean)|null>(null);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [assignmentError, setAssignmentError] = useState<AssignmentError | null>(null);
  const [params, setParams] = useSearchParams();
  const editor = useProjectDocument(projectId, initialSnapshot, initialRevision, undefined,
    async (xml, base, operationId, sequence, etag) => {
      const saved = await studioS4.saveRichDocument(projectId, xml, base, operationId, sequence, etag);
      return { revision: saved.revision, etag: saved.etag };
    }, asset?.id??null);
  const latestEditor=useRef(editor);latestEditor.current=editor;
  const { selection, expanded, setSelectedSegments } = useEditorSelection()!;
  const selectedLineId = selectionLineId(selection) ?? expanded.at(-1) ?? params.get('line');
  const [message, setMessage] = useNotice();
  const query=useQueryClient(), knownSource=useRef(asset?.id??null);
  const [importRequest,setImportRequest]=useState(0);
  const refreshMedia=async()=>{
    sessionStorage.removeItem(scopedSessionKey(`studio-vocal-intent-v1:${projectId}`));
    setSelectedSegments([]);
    await query.invalidateQueries({predicate:q=>q.queryKey.includes(projectId)&&q.queryKey[0]!=='document-envelope'});
  };
  useEffect(()=>listenSourceChanged(projectId,()=>{transport.current?.pause();void query.invalidateQueries({queryKey:['project',projectId]});}),[projectId,query]);
  useEffect(()=>{
    const id=asset?.id??null;if(knownSource.current===id)return;
    transport.current?.pause();let active=true;
    void studioS4.getDocumentEnvelope(projectId).then(async envelope=>{
      if(!active)return;if(envelope.source_asset_id!==id){await query.invalidateQueries({queryKey:['project',projectId]});return;}
      await editor.acceptSource(id,envelope.revision,envelope.document as ProjectSnapshot);
      knownSource.current=id;await refreshMedia();
    }).catch(cause=>setMessage(errorMessage(cause)));
    return ()=>{active=false;};
  },[asset?.id,projectId]);

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
  if (editor.deleted) return <main><p role="alert">{t('workspace.deleted')}</p><a href="/projects">{t('workspace.back')}</a></main>;
  const exportFormat = (format: LyricFormat, content = exportLyricFile(editor.document, format, editor.project.editing)) => {
    download(content, `${title}.${format === 'elrc' ? 'extended.lrc' : format}`);
  };
  return <KaraokeContext value={{project:editor.project,locked:editor.editingLocked,apply:command=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject(command);}}}><ProjectEditingContext value={editor.project.editing}><div className={styles.editorShell} onKeyDown={event=>{
    if(event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || !(event.ctrlKey||event.metaKey) || (event.target as Element).closest('input,textarea,select,[role="dialog"]'))return;
    if(event.key.toLowerCase()==='z'&&!editor.editingLocked){event.preventDefault();if(event.shiftKey)editor.redo();else editor.undo();}
    if(event.key.toLowerCase()==='s'){event.preventDefault();void editor.save();}
  }}><EditorWorkspace prepareAudioImport={prepareAudioImport} onImportAudio={()=>setImportRequest(v=>v+1)} alignment={{locked:editor.editingLocked,lock:editor.lockEditing,save:editor.saveForPackaging}} historyVersion={editor.historyVersion} project={editor.project} applyProject={command=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject(command);}} sourceAssetId={asset?.id} audioDurationMs={asset?.source_duration_ms ?? undefined} onTimelineHost={setTimelineHost} assignmentError={assignmentError} embedded projectId={projectId} title={title} document={editor.document} apply={(command) => { if (!editor.apply(command)) throw new MessageError(describeMessage('workspace.conflict')); }} undo={editor.undo} redo={editor.redo}
    canUndo={editor.canUndo&&!editor.editingLocked} canRedo={editor.canRedo&&!editor.editingLocked} dirty={editor.dirty} saving={editor.saving} outputIssues={outputIssues} notices={[message, editor.errorNotice]}
    onSave={() => void editor.save()} onExportFormat={exportFormat}
    saveForPackaging={editor.saveForPackaging}
    selectedLineId={selectedLineId} playheadLineId={playheadLineId} transport={asset ? transport : undefined} />
    {editor.recovery.available && <aside>{t('workspace.recoveryFound')}<div className={styles.recoveryActions}><button data-role="secondary" onClick={() => void editor.restore().catch((error) => setMessage(errorMessage(error)))}>{t('workspace.restore')}</button><button data-role="secondary" onClick={() => void editor.discardRecovery().catch((error) => setMessage(errorMessage(error)))}>{t('workspace.discard')}</button></div></aside>}
    {editor.conflict && <aside role="alert">{t('workspace.newRevision')}<div className={styles.recoveryActions}><button data-role="secondary" onClick={() => { setOutputIssues([]); try { exportFormat('ttml'); } catch(e) { if(e instanceof DocumentOutputError)setOutputIssues(e.issues); else setMessage(errorMessage(e)); } }}>{t('workspace.localTtml')}</button>{outputIssues.length>0 && <p>{t('workspace.issueCount',{count:outputIssues.length})}</p>}<button data-role="secondary" onClick={() => { if (window.confirm(t('workspace.reloadConfirm'))) void editor.discardRecovery().then(() => window.location.reload()); }}>{t('workspace.reloadServer')}</button></div></aside>}
    {asset ? <MediaTransport key={asset.id} editingLocked={editor.editingLocked} timelineHost={timelineHost} acoustics={editor.project.acoustics} onAcoustics={acoustics=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject({type:'acoustics',acoustics});}} onAssign={(lineId,segment)=>{
      try { if(!editor.apply(assignVocalSegmentCommand(editor.project,lineId,segment)))throw new MessageError(describeMessage('workspace.conflict'));setAssignmentError(null); }
      catch(e){if(e instanceof AssignmentError)setAssignmentError(e);throw e;}
    }} ref={transport} projectId={projectId} selectedLine={line ? { begin_ms: line.beginMs, end_ms: line.endMs } : undefined} asset={asset}
      document={editor.document} selectedLineId={line?.id ?? null} onTimelineCommand={(command) => { if (!editor.apply(command)) throw new MessageError(describeMessage('workspace.conflict')); }}
      onPosition={(positionMs) => {
        const active = editor.document.lines.find((item) => !item.backgroundOf && item.beginMs !== null && item.endMs !== null && item.beginMs <= positionMs && positionMs < item.endMs)?.id ?? null;
        setPlayheadLineId((current) => current === active ? current : active);
      }} /> : null}<MusicUpload projectId={projectId} assetId={asset?.id??null} openRequest={importRequest}
    prepare={async()=>{if(!prepareAudioImport.current?.())throw new MessageError(describeMessage('editor.fixInput'));return latestEditor.current.prepareSource();}} stop={()=>transport.current?.pause()} accepted={async result=>{
      await editor.acceptSource(result.asset.id,result.revision);knownSource.current=result.asset.id;
      query.setQueryData(['project',projectId],(previous:object|undefined)=>({...previous,asset:result.asset}));
      await refreshMedia();announceSourceChanged(projectId);
    }}/></div></ProjectEditingContext></KaraokeContext>;
}

const t=i18n.t.bind(i18n);
