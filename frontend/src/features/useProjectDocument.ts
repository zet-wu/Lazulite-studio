import {backgroundDefaults} from '../adapters/studio-preferences';
import { isRejectedDocument } from '../adapters/http/client';
import { message, MessageError, errorMessage } from '../domain/messages';
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
  const checkpointSerial = useRef(0);
  const checkpointTimer = useRef<number | null>(null);
  const pendingCheckpoint = useRef<{ project: ProjectDocument; baseRevision: string; sourceAssetId: string | null } | null>(null);
  const enqueueRecovery = useCallback((operation: () => Promise<void>) => {
    const next = recoveryQueue.current.catch(() => undefined).then(operation);
    recoveryQueue.current = next;
    return next;
  }, []);
  const cancelPendingCheckpoint = useCallback(() => {
    ++checkpointSerial.current;
    pendingCheckpoint.current = null;
    if (checkpointTimer.current !== null) {
      window.clearTimeout(checkpointTimer.current);
      checkpointTimer.current = null;
    }
  }, []);
  const writeCheckpoint = useCallback(
    async (project: ProjectDocument, baseRevision: string, assetId: string | null) => {
      if (deletedRef.current) return;
      const serial = ++checkpointSerial.current;
      await enqueueRecovery(async () => {
        if (deletedRef.current || serial !== checkpointSerial.current) return;
        await createRecoveryAdapter().save(projectId, project, baseRevision, assetId);
      });
    },
    [enqueueRecovery, projectId],
  );
  const flushCheckpoint = useCallback(() => {
    if (checkpointTimer.current !== null) {
      clearTimeout(checkpointTimer.current);
      checkpointTimer.current = null;
    }
    const entry = pendingCheckpoint.current;
    pendingCheckpoint.current = null;
    if (entry && !deletedRef.current) {
      void writeCheckpoint(entry.project, entry.baseRevision, entry.sourceAssetId).catch(() =>
        setError(message('save.checkpointFailed')),
      );
    }
  }, [writeCheckpoint]);
  useEffect(() => {
    window.addEventListener('pagehide', flushCheckpoint);
    window.addEventListener('beforeunload', flushCheckpoint);
    return () => {
      window.removeEventListener('pagehide', flushCheckpoint);
      window.removeEventListener('beforeunload', flushCheckpoint);
      if (checkpointTimer.current !== null) {
        clearTimeout(checkpointTimer.current);
        checkpointTimer.current = null;
      }
    };
  }, [flushCheckpoint]);
  const checkpoint = useCallback(
    async (next: ProjectEditorState) => {
      await writeCheckpoint(next.present, revision, sourceIdentity.current);
    },
    [revision, writeCheckpoint],
  );
  const commit = useCallback(
    (next: ProjectEditorState) => {
      ++sequence.current;
      setDirty(true);
      setError(null);
      pendingCheckpoint.current = { project: next.present, baseRevision: revision, sourceAssetId: sourceIdentity.current };
      if (checkpointTimer.current !== null) clearTimeout(checkpointTimer.current);
      checkpointTimer.current = window.setTimeout(flushCheckpoint, 300);
    },
    [flushCheckpoint, revision],
  );
  const dispatch = useCallback(
    (command: LyricCommand) => {
      if (editingLock.current) throw new MessageError(message('save.editingLocked'));
      const next = executeProjectCommand(stateRef.current, { type: 'lyrics', command }, backgroundDefaults());
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
        cancelPendingCheckpoint();
        await enqueueRecovery(() => createRecoveryAdapter().clear(projectId));
        setRecovery({ available: false });
      } else {
        cancelPendingCheckpoint();
        await writeCheckpoint(stateRef.current.present, result.revision, sourceIdentity.current);
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
  }, [cancelPendingCheckpoint, conflict, dirty, enqueueRecovery, etag, projectId, revision, saveDocument, writeCheckpoint]);
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
    cancelPendingCheckpoint();
    await enqueueRecovery(() => createRecoveryAdapter().clear(projectId));
    setRecovery({ available: false });
  }, [cancelPendingCheckpoint, enqueueRecovery, projectId]);
  const restore = useCallback(async () => {
    const ok = await recover();
    if (ok) setRecovery({ available: false });
    return ok;
  }, [recover]);
  useEffect(() => listenProjectDeletion(projectId, () => {
    deletedRef.current = true; setDeleted(true);
  }), [projectId]);
  useEffect(() => {
    if (deleted) {
      cancelPendingCheckpoint();
      void enqueueRecovery(() => clearProjectLocalData(projectId)).catch(() => setError(message('save.deletedCleanupFailed')));
    }
  }, [cancelPendingCheckpoint, deleted, enqueueRecovery, projectId]);
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
        cancelPendingCheckpoint();
        await checkpoint(next);
      } else {
        pending.current=null;setRevision(nextRevision);setEtag(`"${nextRevision}"`);
        savedSequence.current=sequence.current;setDirty(false);
        cancelPendingCheckpoint();
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
    applyProject: (command: ProjectCommand) => history(s => executeProjectCommand(s, command, backgroundDefaults())),
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
