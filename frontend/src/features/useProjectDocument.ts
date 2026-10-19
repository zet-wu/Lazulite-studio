import { projectErrorText } from './project-error';
import { useNotice } from '../shared/MessageBar';
import { useCallback, useEffect, useRef, useState } from "react";
import { listenProjectDeletion, clearProjectLocalData } from "../adapters/project-lifecycle";
import { createRecoveryAdapter } from "../adapters/recovery";
import { parseProject, serializeProject } from '../adapters/project-codec';
import { createProjectEditorState, executeProjectCommand, redoProjectCommand, undoProjectCommand, type ProjectEditorState, type ProjectSnapshot, type ProjectCommand } from '../domain/project-document';
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
) {
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
      await enqueueRecovery(async () => { if (!deletedRef.current) await createRecoveryAdapter().save(projectId, next.present, revision); });
    },
    [enqueueRecovery, projectId, revision],
  );
  const commit = useCallback(
    (next: ProjectEditorState) => {
      ++sequence.current;
      setDirty(true);
      setError(null);
      void checkpoint(next).catch(() =>
        setError("本地检查点保存失败，当前修改仍保留"),
      );
    },
    [checkpoint],
  );
  const dispatch = useCallback(
    (command: LyricCommand) => {
      if (editingLock.current) throw new Error('自动对齐期间无法编辑');
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
    if (deletedRef.current) { if (forPackaging) throw new Error("项目已删除"); return; }
    if (inFlight.current || conflict) {
      if (forPackaging) throw new Error(conflict ? '保存冲突，请先处理' : '正在保存，请完成后重试打包');
      return;
    }
    if (forPackaging && pending.current) throw new Error('上次保存尚未确认，请先重试保存再打包');
    const captured = stateRef.current.present;
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
      if (deletedRef.current) return;
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
        ));
      }
      return { revision: result.revision, document: captured.lyrics, editing: captured.editing };
    } catch (caught) {
      if ((caught as { status?: number }).status === 404) { deletedRef.current = true; setDeleted(true); }
      if ((caught as { status?: number }).status === 412) setConflict(true);
      setError(
        caught instanceof Error ? projectErrorText(captured, caught.message) : "保存失败，修改已保留",
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
      if (editingLock.current) throw new Error('自动对齐期间无法编辑');
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
    if (editingLock.current) throw new Error('自动对齐期间无法恢复');
    if (deletedRef.current) return false;
    const adapter = createRecoveryAdapter();
    const record = await adapter.readCheckpoint(projectId);
    if (record) {
      const recovered = createProjectEditorState(record.project);
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
            caught instanceof Error ? caught.message : "本地恢复记录读取失败",
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
    void enqueueRecovery(() => clearProjectLocalData(projectId)).catch(() => setError("项目已删除，本地数据清理失败"));
  }), [enqueueRecovery, projectId]);
  useEffect(() => {
    if (deleted) void enqueueRecovery(() => clearProjectLocalData(projectId)).catch(() => setError("项目已删除，本地数据清理失败"));
  }, [deleted, enqueueRecovery, projectId]);
  return {
    deleted, historyVersion, editingLocked,
    lockEditing: () => {
      if (editingLock.current || conflict || deletedRef.current) throw new Error('项目当前不能开始对齐');
      const token = Symbol('alignment'); editingLock.current = token; setEditingLocked(true);
      const source = stateRef.current.present;
      return { source,
        release: () => { if (editingLock.current === token) { editingLock.current = null; setEditingLocked(false); } },
        apply: (project: ProjectDocument) => {
          if (editingLock.current !== token || deletedRef.current) throw new Error('本次对齐已失效');
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
