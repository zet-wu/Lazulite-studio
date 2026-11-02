import { ApiError, isRejectedDocument } from '../adapters/http/client';
import { message, MessageError, errorMessage } from '../domain/messages';
import { projectErrorText } from './project-error';
import { useNotice } from '../shared/MessageBar';
import { useCallback, useEffect, useRef, useState } from "react";
import { listenProjectDeletion, clearProjectLocalData } from "../adapters/project-lifecycle";
import { createRecoveryAdapter } from "../adapters/recovery";
import { parseProject, serializeProject } from '../adapters/project-codec';
import { clearAcousticHistory, createProjectEditorState, executeProjectCommand, redoProjectCommand, undoProjectCommand, type ProjectEditorState, type ProjectSnapshot, type ProjectCommand } from '../domain/project-document';
import type { ProjectDocument } from '../domain/project-document';
import type { LyricCommand } from '../domain/lyric-commands';

type Save = (
  snapshot: ProjectSnapshot,
  baseRevision: string,
  operationId: string,
  sequence: number,
  etag?: string,
) => Promise<{ revision: string; etag?: string }>;
export function useProjectDocument(
  projectId: string,
  initialSnapshot: ProjectSnapshot,
  initialRevision: string,
  initialEtag: string | undefined,
  saveDocument: Save,
  sourceAssetId: string | null = null,
) {
  const sourceIdentity = useRef(sourceAssetId);
  const editingLock = useRef<symbol | null>(null);
  const [editingLocked, setEditingLocked] = useState(false);
  const savedSequence = useRef(0);
  const deletedRef = useRef(false);
  const [deleted, setDeleted] = useState(false);
  const [state, setState] = useState<ProjectEditorState>(() =>
    createProjectEditorState(parseProject(initialSnapshot)),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [revision, setRevision] = useState(initialRevision);
  const [etag, setEtag] = useState<string | undefined>(initialEtag);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errorNotice, setError] = useNotice();
  const error = errorNotice?.text ?? null;
  const [recovery, setRecovery] = useState<{
    available: boolean;
    baseRevision?: string;
  }>({ available: false });
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{
    uuid: string;
    seq: number;
    base: string;
    snapshot: ProjectSnapshot;
  } | null>(null);
  const recoveryQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueRecovery = useCallback((operation: () => Promise<void>) => {
    const next = recoveryQueue.current.catch(() => undefined).then(operation);
    recoveryQueue.current = next;
    return next;
  }, []);
  const checkpoint = useCallback(
    async (next: ProjectEditorState) => {
      if (deletedRef.current) return;
      await enqueueRecovery(async () => { if (!deletedRef.current) await createRecoveryAdapter().save(projectId, next.present, revision, sourceIdentity.current); });
    },
    [enqueueRecovery, projectId, revision],
  );
  const commit = useCallback(
    (next: ProjectEditorState) => {
      ++sequence.current;
      setDirty(true);
      setError(null);
      void checkpoint(next).catch(() =>
        setError(message('save.checkpointFailed')),
      );
    },
    [checkpoint],
  );
  const dispatch = useCallback(
    (command: LyricCommand) => {
      if (editingLock.current) throw new MessageError(message('save.editingLocked'));
      const next = executeProjectCommand(stateRef.current, { type: 'lyrics', command });
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        commit(next);
      }
    },
    [commit],
  );
  const save = useCallback(async (forPackaging = false) => {
    if (deletedRef.current) { if (forPackaging) throw new MessageError(message('save.deleted')); return; }
    if (inFlight.current || conflict) {
      if (forPackaging) throw new MessageError(message(conflict?'save.conflict':'save.waitForPackaging'));
      return;
    }
    if (forPackaging && pending.current) throw new MessageError(message('save.uncertainPackaging'));
    const captured = stateRef.current.present;
    const saveSource = sourceIdentity.current;
    if (sequence.current === savedSequence.current) return { revision, document: captured.lyrics, editing: captured.editing };
    inFlight.current = true;
    setSaving(true);
    try {
      if (!pending.current)
        pending.current = {
          uuid: crypto.randomUUID(),
          seq: sequence.current,
          base: revision,
          snapshot: serializeProject(stateRef.current.present),
        };
      const request = pending.current;
      const result = await saveDocument(
        request.snapshot,
        request.base,
        request.uuid,
        request.seq,
        etag,
      );
      if (deletedRef.current || saveSource !== sourceIdentity.current) return;
      setRevision(result.revision);
      setEtag(result.etag);
      setError(null);
      savedSequence.current = request.seq;
      pending.current = null;
      if (sequence.current === request.seq) {
        setDirty(false);
        await enqueueRecovery(() => createRecoveryAdapter().clear(projectId));
        setRecovery({ available: false });
      } else {
        await enqueueRecovery(() => createRecoveryAdapter().save(
          projectId,
          stateRef.current.present,
          result.revision,
          sourceIdentity.current,
        ));
      }
      return { revision: result.revision, document: captured.lyrics, editing: captured.editing };
    } catch (caught) {
      if (isRejectedDocument(caught)) pending.current = null;
      if ((caught as { status?: number }).status === 404) { deletedRef.current = true; setDeleted(true); }
      if ((caught as { status?: number }).status === 412) setConflict(true);
      setError(
        errorMessage(caught),
      );
      if (forPackaging) throw caught;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [conflict, dirty, enqueueRecovery, etag, projectId, revision, saveDocument]);
  useEffect(() => {
    if (!dirty || error || conflict || deleted) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [conflict, deleted, dirty, error, save]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useCallback(
    (change: (s: ProjectEditorState) => ProjectEditorState) => {
      if (editingLock.current) throw new MessageError(message('save.editingLocked'));
      if (conflict || deletedRef.current) return;
      const next = change(stateRef.current);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        commit(next);
      }
    },
    [commit, conflict],
  );
  const apply = useCallback(
    (command: LyricCommand) => {
      if (conflict || deletedRef.current) return false;
      dispatch(command);
      return true;
    },
    [conflict, dispatch],
  );
  const recover = useCallback(async () => {
    if (editingLock.current) throw new MessageError(message('save.recoveryLocked'));
    if (deletedRef.current) return false;
    const adapter = createRecoveryAdapter();
    const record = await adapter.readCheckpoint(projectId);
    if (record) {
      const recovered = record.sourceAssetId===sourceIdentity.current ? createProjectEditorState(record.project) : clearAcousticHistory(createProjectEditorState(record.project));
      stateRef.current = recovered;
      setState(recovered);
      ++sequence.current;
      setDirty(true);
      if (record.baseRevision !== revision)
        setConflict(true);
      return true;
    }
    return false;
  }, [projectId, revision]);
  useEffect(() => {
    let active = true;
    void createRecoveryAdapter()
      .readCheckpoint(projectId)
      .then((record) => {
        if (active && record)
          setRecovery({ available: true, baseRevision: record.baseRevision });
      })
      .catch((caught) => {
        if (active)
          setError(
            errorMessage(caught),
          );
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  const discardRecovery = useCallback(async () => {
    await enqueueRecovery(() => createRecoveryAdapter().clear(projectId));
    setRecovery({ available: false });
  }, [enqueueRecovery, projectId]);
  const restore = useCallback(async () => {
    const ok = await recover();
    if (ok) setRecovery({ available: false });
    return ok;
  }, [recover]);
  useEffect(() => listenProjectDeletion(projectId, () => {
    deletedRef.current = true; setDeleted(true);
    void enqueueRecovery(() => clearProjectLocalData(projectId)).catch(() => setError(message('save.deletedCleanupFailed')));
  }), [enqueueRecovery, projectId]);
  useEffect(() => {
    if (deleted) void enqueueRecovery(() => clearProjectLocalData(projectId)).catch(() => setError(message('save.deletedCleanupFailed')));
  }, [deleted, enqueueRecovery, projectId]);
  return {
    deleted, historyVersion, editingLocked,
    acceptSource: async (assetId: string | null, nextRevision: string, remote?: ProjectSnapshot) => {
      const changed = sourceIdentity.current !== assetId;
      sourceIdentity.current=assetId;
      if (!changed) return;
      const hasLocalChanges=sequence.current!==savedSequence.current || !!pending.current || !!inFlight.current;
      const next=remote && !hasLocalChanges ? createProjectEditorState(parseProject(remote)) : clearAcousticHistory(stateRef.current);
      stateRef.current=next;setState(next);setHistoryVersion(v=>v+1);
      if (remote && hasLocalChanges) {
        setConflict(true);setError(message('save.sourceConflict'));
        await checkpoint(next);
      } else {
        pending.current=null;setRevision(nextRevision);setEtag(`"${nextRevision}"`);
        savedSequence.current=sequence.current;setDirty(false);
        await enqueueRecovery(()=>createRecoveryAdapter().clear(projectId));setRecovery({available:false});
      }
    },
    prepareSource: async () => {
      if(editingLock.current || conflict || deletedRef.current || inFlight.current || pending.current) throw new MessageError(message('save.finishBeforeImport'));
      const token=Symbol('music');editingLock.current=token;setEditingLocked(true);
      const release=()=>{if(editingLock.current===token){editingLock.current=null;setEditingLocked(false);}};
      try { const saved=await save(true);if(!saved)throw new MessageError(message('alignment.saveRequired'));return {revision:saved.revision,release}; }
      catch(error){release();throw error;}
    },
    lockEditing: () => {
      if (editingLock.current || conflict || deletedRef.current) throw new MessageError(message('save.alignmentUnavailable'));
      const token = Symbol('alignment'); editingLock.current = token; setEditingLocked(true);
      const source = stateRef.current.present;
      return { source,
        release: () => { if (editingLock.current === token) { editingLock.current = null; setEditingLocked(false); } },
        apply: (project: ProjectDocument) => {
          if (editingLock.current !== token || deletedRef.current) throw new MessageError(message('save.alignmentExpired'));
          const next = executeProjectCommand(stateRef.current, {type:'alignment', source, project});
          if (next !== stateRef.current) {stateRef.current=next;setState(next);commit(next);}
        },
      };
    },
    document: state.present.lyrics,
    project: state.present,
    applyProject: (command: ProjectCommand) => history(s => executeProjectCommand(s, command)),
    state,
    revision,
    dirty,
    saving,
    conflict,
    error,
    errorNotice,
    recovery,
    apply,
    save,
    saveForPackaging: () => save(true),
    recover: restore,
    restore,
    discardRecovery,
    reloadRecovery: recover,
    undo: () => { history(undoProjectCommand); setHistoryVersion(v => v + 1); },
    redo: () => { history(redoProjectCommand); setHistoryVersion(v => v + 1); },
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    clearConflict: () => setConflict(false),
  };
}
