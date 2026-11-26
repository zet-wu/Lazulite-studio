import {useShortcuts,matchesBinding,shortcutInput} from './shortcuts';
import { errorMessage, message as describeMessage, MessageError } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { announceSourceChanged, listenSourceChanged } from '../adapters/project-lifecycle';
import { scopedSessionKey } from '../adapters/preferences';
import { KaraokeContext } from './KaraokeContext';
import { useNotice } from '../shared/MessageBar';
import { ProjectEditingContext } from './editor/ProjectEditingContext';
import { selectionLineId } from './editor/editing-actions';
import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { AudioReviewProvider, useAudioReview } from './AudioReviewContext';
import { createActiveLineTracker } from '../domain/active-lines';
import { assignVocalSegmentCommand, AssignmentError } from '../domain/vocal-editing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { isBrowserRuntime } from '../adapters/runtime';
import { getAudioObjectUrl, isEphemeralAsset } from '../adapters/browser/media';
import { retainProjectMedia } from '../adapters/http/media-lifetime';
import { studioApi, type Asset } from '../adapters/http/client';
import { subscribeProjectEvents } from '../adapters/http/events';
import { jobsApi } from '../adapters/http/jobs';
import { DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { exportLyricFile, type LyricFormat } from '../adapters/lyric-formats';
import type { ProjectSnapshot } from '../domain/project-document';
import { downloadBlob } from '../shared/download';
import { FloatingTrayProvider, useTrayEntry } from './FloatingTray';
import { MediaTransport, type TransportHandle } from './MediaTransport';
import { deviceSummary } from './task-messages';
import { useBackgroundJobRecovery } from './useBackgroundJobRecovery';
import { useProjectJobs } from './useProjectJobs';
import { EditorWorkspace } from './editor/EditorWorkspace';
import { useProjectDocument } from './useProjectDocument';
import { MusicUpload } from './MusicUpload';
import styles from './workspace.module.css';

export function Workspace({ projectId }: { projectId: string }) {
  useTranslation();
  const [cleanupError,setCleanupError]=useMessageText('');
  useEffect(() => isBrowserRuntime ? retainProjectMedia(projectId, cause => setCleanupError(errorMessage(cause))) : undefined, [projectId, setCleanupError]);
  const envelope = useQuery({ queryKey: ['document-envelope', projectId], queryFn: () => studioApi.getDocumentEnvelope(projectId), refetchOnMount: 'always', refetchOnWindowFocus: false });
  const project = useQuery({ queryKey: ['project', projectId], queryFn: ({ signal }) => studioApi.getProject(projectId, signal), ...(isBrowserRuntime ? { gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnMount: 'always' as const } : {}) });
  const paired=useRef(false);
  const mismatch=!!envelope.data&&!!project.data&&envelope.data.source_asset_id!==(project.data.asset?.id??null);
  useEffect(()=>{if(mismatch&&!paired.current){void envelope.refetch();void project.refetch();}},[mismatch]);
  if(envelope.data&&project.data&&!mismatch)paired.current=true;
  if(!paired.current&&mismatch)return <main>{t('workspace.sourceChanging')}</main>;
  if (envelope.isLoading || project.isLoading) return <main>{t('workspace.loading')}</main>;
  const loadError = project.error ?? envelope.error;
  if (project.isError || envelope.isError || !envelope.data) return <main><p role="alert">{(loadError as {status?:number})?.status === 404 ? t('workspace.missing') : isBrowserRuntime && loadError ? formatMessage(errorMessage(loadError)) : t('workspace.openFailed')}</p><button data-role="secondary" onClick={() => { void envelope.refetch(); void project.refetch(); }}>{t('common.retry')}</button></main>;
  return <SelectionProvider><AudioReviewProvider><FloatingTrayProvider>{isBrowserRuntime && project.data?.asset && (isEphemeralAsset(project.data.asset) || !getAudioObjectUrl(projectId, project.data.asset.id)) && <aside role="status">{t(getAudioObjectUrl(projectId, project.data.asset.id) ? 'demo.ephemeral' : 'demo.audioMissing')}</aside>}{project.data?.music_cleanup_pending&&<aside role="alert">{t('workspace.cleanupPending')}<button data-role="secondary" onClick={()=>void studioApi.cleanupMusic(projectId).then(()=>project.refetch()).catch(cause=>setCleanupError(errorMessage(cause)))}>{t('music.cleanupRetry')}</button>{cleanupError}</aside>}<ProjectEditor key={projectId} projectId={projectId} title={project.data?.name ?? t('workspace.defaultName')} initialSnapshot={envelope.data.document}
    initialRevision={envelope.data.revision ?? ''} asset={project.data?.asset ?? null} /></FloatingTrayProvider></AudioReviewProvider></SelectionProvider>;
}

function ProjectEditor({ projectId, title, initialSnapshot, initialRevision, asset }: { projectId: string; title: string; initialSnapshot: ProjectSnapshot; initialRevision: string; asset: Asset | null }) {
  useTranslation();
  const keys=useShortcuts();
  const transport = useRef<TransportHandle>(null);
  const prepareAudioImport=useRef<(()=>boolean)|null>(null);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [assignmentError, setAssignmentError] = useState<AssignmentError | null>(null);
  const [params] = useSearchParams();
  const editor = useProjectDocument(projectId, initialSnapshot, initialRevision, undefined,
    async (xml, base, operationId, sequence, etag) => {
      const saved = await studioApi.saveRichDocument(projectId, xml, base, operationId, sequence, etag);
      return { revision: saved.revision, etag: saved.etag };
    }, asset?.id??null);
  const latestEditor=useRef(editor);latestEditor.current=editor;
  const { selection, setSelectedSegments } = useEditorSelection()!;
  const selectedLineId = selection ? selectionLineId(selection) : params.get('line');
  const [message, setMessage] = useNotice();
  const query=useQueryClient(), knownSource=useRef(asset?.id??null);
  const [audioImportBusy,setAudioImportBusy]=useState(false);
  const [importRequest,setImportRequest]=useState(0);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const audioReview = useAudioReview();
  const jobs = useProjectJobs(projectId, true);
  const activeJob = jobs.data?.items.find((job) => ['queued', 'running', 'cancel_requested'].includes(job.status));
  const recovery = useBackgroundJobRecovery({
    projectId,
    sourceAssetId: asset?.id ?? null,
    durationMs: asset?.source_duration_ms ?? asset?.duration_ms ?? null,
    revision: editor.revision,
    dirty: editor.dirty,
    conflict: editor.conflict,
    editingLocked: editor.editingLocked,
    project: editor.project,
    jobs: jobs.data?.items,
    claimedJobIds: audioReview.claimedJobIds,
    lockEditing: editor.lockEditing,
    saveForPackaging: editor.saveForPackaging,
    applyProject: (command) => {
      if (editor.conflict) throw new MessageError(describeMessage('workspace.conflict'));
      editor.applyProject(command);
    },
    requestAlignmentOpen: audioReview.requestAlignmentOpen,
    onNotice: setMessage,
  });
  useEffect(() => {
    if (!activeJob && cancellingJobId) setCancellingJobId(null);
  }, [activeJob, cancellingJobId]);
  useEffect(() => subscribeProjectEvents(projectId, {
    onRevisionChanged: (event) => {
      void latestEditor.current.syncExternalRevision(event.revision);
      void query.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
    },
    onJobUpdated: (event) => {
      void query.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(event.status)) {
        void query.invalidateQueries({ queryKey: ['vocals', projectId] });
      }
    },
    onResync: () => {
      void latestEditor.current.syncExternalRevision();
      void query.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
    },
  }), [projectId, query]);

  useTrayEntry('workspace-message', message ? { kind: 'notice', notice: message } : null);
  useTrayEntry('document-error', editor.errorNotice ? { kind: 'notice', notice: editor.errorNotice } : null);
  const syncNotice = useMemo(
    () =>
      editor.syncNotice
        ? recovery.externalAlignmentApplied
          ? { ...editor.syncNotice, text: describeMessage('sync.externalAlignmentApplied') }
          : editor.syncNotice
        : null,
    [editor.syncNotice, recovery.externalAlignmentApplied],
  );
  useTrayEntry('document-sync', syncNotice ? { kind: 'notice', notice: syncNotice } : null);
  useTrayEntry(
    'bg-alignment-recovery',
    recovery.alignmentPrompt
      ? recovery.alignmentPrompt.kind === 'ready'
        ? {
            kind: 'notice',
            tone: 'info',
            order: 8,
            version: `${recovery.alignmentPrompt.job.id}:ready:${recovery.applyingAlignment}`,
            notice: {
              text: describeMessage('alignment.backgroundReady'),
              role: 'status',
              origin: null,
              dismissible: false,
            },
            actions: (
              <>
                <button
                  data-role="primary"
                  disabled={recovery.applyingAlignment}
                  onClick={() => void recovery.applyAlignment()}
                >
                  {t('alignment.applyResult')}
                </button>
                <button
                  data-role="secondary"
                  disabled={recovery.applyingAlignment}
                  onClick={() => void recovery.dismissAlignment()}
                >
                  {t('alignment.dismissResult')}
                </button>
              </>
            ),
          }
        : {
            kind: 'notice',
            tone: 'warning',
            order: 8,
            version: `${recovery.alignmentPrompt.job.id}:${recovery.alignmentPrompt.kind}`,
            notice: {
              text: describeMessage(
                recovery.alignmentPrompt.kind === 'dirty'
                  ? 'alignment.backgroundDirty'
                  : 'alignment.backgroundStale',
              ),
              role: 'alert',
              origin: null,
              dismissible: false,
            },
            actions: (
              <>
                {recovery.alignmentPrompt.kind === 'stale' && (
                  <button data-role="primary" onClick={() => void recovery.rerunAlignment()}>
                    {t('alignment.rerun')}
                  </button>
                )}
                <button data-role="secondary" onClick={() => void recovery.dismissAlignment()}>
                  {t('alignment.dismissResult')}
                </button>
              </>
            ),
          }
      : null,
  );
  useTrayEntry(
    'bg-vocal-conflict',
    recovery.vocalConflictPrompt
      ? {
          kind: 'notice',
          tone: 'warning',
          order: 8,
          version: `${recovery.vocalConflictPrompt.job.id}:${recovery.busyVocal}`,
          notice: {
            text: describeMessage('vocal.backgroundConflict'),
            role: 'alert',
            origin: null,
            dismissible: false,
          },
          actions: (
            <>
              <button
                data-role="primary"
                disabled={recovery.busyVocal}
                onClick={() => void recovery.adoptVocal()}
              >
                {t('vocal.replaceSegments')}
              </button>
              <button
                data-role="secondary"
                disabled={recovery.busyVocal}
                onClick={() => void recovery.dismissVocal()}
              >
                {t('vocal.previous')}
              </button>
            </>
          ),
        }
      : null,
  );
  const failureNotice = useMemo(
    () =>
      recovery.failurePrompt
        ? {
            text: recovery.failurePrompt.message,
            role: 'alert' as const,
            origin: null,
            dismissible: true,
            taskId: recovery.failurePrompt.job.id,
            onDismiss: () => {
              void recovery.dismissFailure();
            },
          }
        : null,
    [recovery.failurePrompt?.job.id, recovery.dismissFailure],
  );
  useTrayEntry(
    'bg-job-failure',
    failureNotice
      ? {
          kind: 'notice',
          tone: 'alert',
          order: 9,
          version: recovery.failurePrompt?.job.id,
          notice: failureNotice,
        }
      : null,
  );
  useTrayEntry(
    'external-conflict',
    editor.externalUpdate
      ? {
          kind: 'notice',
          tone: 'warning',
          order: 5,
          version: editor.externalUpdate.revision,
          notice: {
            text: describeMessage('sync.externalConflict'),
            role: 'alert',
            origin: null,
            dismissible: false,
          },
          actions: (
            <>
              <button
                data-role="primary"
                onClick={() =>
                  void editor.reloadExternal().catch((cause) => setMessage(errorMessage(cause)))
                }
              >
                {t('sync.reloadExternal')}
              </button>
              <button data-role="secondary" onClick={editor.keepLocalDraft}>
                {t('sync.keepLocal')}
              </button>
            </>
          ),
        }
      : null,
  );
  const activeJobText = activeJob
    ? (() => {
        const deviceText = deviceSummary(activeJob.request?.devices);
        const cancelling = cancellingJobId === activeJob.id || activeJob.status === 'cancel_requested';
        if (activeJob.kind === 'vocal') {
          const statusLabel = {
            queued: t('task.queued'),
            running: t('task.processing'),
            cancel_requested: t('task.waitingCancel'),
            cancelled: t('task.cancelled'),
            failed: t('task.failed'),
            interrupted: t('task.interrupted'),
            succeeded: t('task.applying'),
          }[activeJob.status];
          const stageLabel = activeJob.stage
            ? ({ separating: t('vocal.separate'), analyzing: t('vocal.acousticAnalysis') }[activeJob.stage] ?? activeJob.stage)
            : '';
          return t('task.vocalProgress', {
            progress: `${cancelling ? t('task.cancelling') : statusLabel}${stageLabel ? ` · ${stageLabel}` : ''}`,
            device: deviceText ? ` · ${deviceText}` : '',
          });
        }
        const stageText = cancelling
          ? t('task.cancelling')
          : activeJob.status === 'queued'
            ? t('task.queued')
            : ({
                separating: t('task.separating'),
                analyzing: t('task.analyzingRegions'),
                acoustic: t('task.probabilities'),
                decode: t('task.globalAlignment'),
              }[activeJob.stage ?? ''] ?? t('task.aligning'));
        return t('task.alignmentProgress', {
          progress: stageText,
          device: deviceText ? ` · ${deviceText}` : '',
        });
      })()
    : '';
  const activeJobNotice = useMemo(
    () =>
      activeJob
        ? {
            text: activeJobText,
            role: 'status' as const,
            origin: null,
            dismissible: false,
          }
        : null,
    [activeJob?.id, activeJobText],
  );
  useTrayEntry(
    'active-job',
    activeJob && activeJobNotice
      ? {
          kind: 'task',
          order: 10,
          version: `${activeJob.id}:${activeJob.status}:${activeJob.stage ?? ''}:${cancellingJobId === activeJob.id}`,
          notice: activeJobNotice,
          actions: (
            <button
              data-role="secondary"
              disabled={cancellingJobId === activeJob.id || activeJob.status === 'cancel_requested'}
              onClick={() => {
                setCancellingJobId(activeJob.id);
                void jobsApi
                  .cancel(activeJob.id)
                  .then(() => query.invalidateQueries({ queryKey: ['vocal-jobs', projectId] }))
                  .catch((cause) => {
                    setCancellingJobId(null);
                    setMessage(
                      describeMessage('task.cancelFailed', {
                        diagnostic: cause instanceof Error ? cause.message : String(cause),
                      }),
                    );
                  });
              }}
            >
              {t('task.cancel')}
            </button>
          ),
        }
      : null,
  );
  const refreshMedia=async()=>{
    sessionStorage.removeItem(scopedSessionKey(`studio-vocal-intent-v1:${projectId}`));
    setSelectedSegments([]);
    await query.invalidateQueries({predicate:q=>q.queryKey.includes(projectId)&&q.queryKey[0]!=='document-envelope'});
  };
  useEffect(()=>listenSourceChanged(projectId,()=>{transport.current?.pause();void query.invalidateQueries({queryKey:['project',projectId]});}),[projectId,query]);
  useEffect(()=>{
    const id=asset?.id??null;if(knownSource.current===id)return;
    transport.current?.pause();let active=true;
    void studioApi.getDocumentEnvelope(projectId).then(async envelope=>{
      if(!active)return;if(envelope.source_asset_id!==id){await query.invalidateQueries({queryKey:['project',projectId]});return;}
      await editor.acceptSource(id,envelope.revision,envelope.document as ProjectSnapshot);
      knownSource.current=id;await refreshMedia();
    }).catch(cause=>setMessage(errorMessage(cause)));
    return ()=>{active=false;};
  },[asset?.id,projectId]);

  const [outputIssues,setOutputIssues] = useState<OutputIssue[]>([]);
  const [playheadLineId, setPlayheadLineId] = useState<string | null>(null);
  const playheadTracker = useMemo(() => createActiveLineTracker(editor.document.lines, true), [editor.document.lines]);
  const handlePosition = useCallback((positionMs: number) => {
    const active = playheadTracker.firstId(positionMs);
    setPlayheadLineId((current) => current === active ? current : active);
  }, [playheadTracker]);
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
    downloadBlob(content, `${title}.${format === 'elrc' ? 'extended.lrc' : format}`, format === 'ttml' ? 'application/ttml+xml' : 'text/plain;charset=utf-8');
  };
  return <KaraokeContext value={{project:editor.project,locked:editor.editingLocked,apply:command=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject(command);}}}><ProjectEditingContext value={editor.project.editing}><div className={styles.editorShell} onKeyDown={event=>{
    if(event.defaultPrevented||event.nativeEvent.isComposing||window.document.querySelector('[role="dialog"], [role="menu"], details[data-top-menu][open]'))return;
    if(matchesBinding(event.nativeEvent,keys.save)){event.preventDefault();if(!editor.saving)void editor.save();return;}
    if(shortcutInput(event.target,event.code)||editor.editingLocked)return;
    if(matchesBinding(event.nativeEvent,keys.undo)){event.preventDefault();editor.undo();}
    else if(matchesBinding(event.nativeEvent,keys.redo)){event.preventDefault();editor.redo();}
  }}><EditorWorkspace audioImportDisabled={audioImportBusy||editor.editingLocked||editor.saving} prepareAudioImport={prepareAudioImport} onImportAudio={()=>setImportRequest(v=>v+1)} alignment={{locked:editor.editingLocked,lock:editor.lockEditing,save:editor.saveForPackaging}} historyVersion={editor.historyVersion} project={editor.project} applyProject={command=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject(command);}} sourceAssetId={asset?.id} audioDurationMs={asset?.source_duration_ms ?? undefined} onTimelineHost={setTimelineHost} assignmentError={assignmentError} projectId={projectId} title={title} document={editor.document} apply={(command) => { if (!editor.apply(command)) throw new MessageError(describeMessage('workspace.conflict')); }} undo={editor.undo} redo={editor.redo}
    canUndo={editor.canUndo&&!editor.editingLocked} canRedo={editor.canRedo&&!editor.editingLocked} dirty={editor.dirty} saving={editor.saving}
    onSave={() => void editor.save()}
    saveForPackaging={editor.saveForPackaging}
    selectedLineId={selectedLineId} playheadLineId={playheadLineId} transport={asset ? transport : undefined} />
    {editor.recovery.available && <aside>{t('workspace.recoveryFound')}<div className={styles.recoveryActions}><button data-role="secondary" onClick={() => void editor.restore().catch((error) => setMessage(errorMessage(error)))}>{t('workspace.restore')}</button><button data-role="secondary" onClick={() => void editor.discardRecovery().catch((error) => setMessage(errorMessage(error)))}>{t('workspace.discard')}</button></div></aside>}
    {editor.conflict && <aside role="alert">{t('workspace.newRevision')}<div className={styles.recoveryActions}><button data-role="secondary" onClick={() => { setOutputIssues([]); try { exportFormat('ttml'); } catch(e) { if(e instanceof DocumentOutputError)setOutputIssues(e.issues); else setMessage(errorMessage(e)); } }}>{t('workspace.localTtml')}</button>{outputIssues.length>0 && <p>{t('workspace.issueCount',{count:outputIssues.length})}</p>}<button data-role="secondary" onClick={() => { if (window.confirm(t('workspace.reloadConfirm'))) void editor.discardRecovery().then(() => window.location.reload()); }}>{t('workspace.reloadServer')}</button></div></aside>}
    {asset ? <MediaTransport key={asset.id} editingLocked={editor.editingLocked} timelineHost={timelineHost} acoustics={editor.project.acoustics} onAcoustics={acoustics=>{if(editor.conflict)throw new MessageError(describeMessage('workspace.conflict'));editor.applyProject({type:'acoustics',acoustics});}} onAssign={(lineId,segment)=>{
      try { if(!editor.apply(assignVocalSegmentCommand(editor.project,lineId,segment)))throw new MessageError(describeMessage('workspace.conflict'));setAssignmentError(null); }
      catch(e){if(e instanceof AssignmentError)setAssignmentError(e);throw e;}
    }} ref={transport} projectId={projectId} selectedLine={line ? { begin_ms: line.beginMs, end_ms: line.endMs } : undefined} asset={asset}
      document={editor.document} selectedLineId={line?.id ?? null} onTimelineCommand={(command) => { if (!editor.apply(command)) throw new MessageError(describeMessage('workspace.conflict')); }}
      onPosition={handlePosition} /> : null}<MusicUpload disabled={editor.editingLocked||editor.saving} onBusyChange={setAudioImportBusy} projectId={projectId} assetId={asset?.id??null} openRequest={importRequest}
    prepare={async()=>{if(!prepareAudioImport.current?.())throw new MessageError(describeMessage('editor.fixInput'));return latestEditor.current.prepareSource();}} stop={()=>transport.current?.pause()} accepted={async result=>{
      await editor.acceptSource(result.asset.id,result.revision);knownSource.current=result.asset.id;
      query.setQueryData(['project',projectId],(previous:object|undefined)=>({...previous,asset:result.asset}));
      await refreshMedia();announceSourceChanged(projectId);
    }}/></div></ProjectEditingContext></KaraokeContext>;
}

const t=i18n.t.bind(i18n);
