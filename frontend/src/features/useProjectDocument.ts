import { useCallback, useEffect, useRef, useState } from "react";
import { createRecoveryAdapter } from "../adapters/recovery";
import { parseStudioTtml, serializeStudioTtml } from "../adapters/ttml";
import {
  canRedo,
  canUndo,
  createEditorState,
  executeCommand,
  redo,
  undo,
  type EditCommand,
  type EditorState,
} from "../domain/editing";
import type { StudioLyricDocument } from "../domain/document";

type Save = (
  ttml: string,
  baseRevision: string,
  operationId: string,
  sequence: number,
  etag?: string,
) => Promise<{ revision: string; etag?: string }>;
export function useProjectDocument(
  projectId: string,
  initialTtml: string,
  initialRevision: string,
  initialEtag: string | undefined,
  saveDocument: Save,
) {
  const identity = projectId;
  const [state, setState] = useState<EditorState>(() =>
    createEditorState(parseStudioTtml(initialTtml)),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [revision, setRevision] = useState(initialRevision);
  const [etag, setEtag] = useState<string | undefined>(initialEtag);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    xml: string;
  } | null>(null);
  const checkpoint = useCallback(
    async (next: EditorState) => {
      await createRecoveryAdapter().save(projectId, identity, next, revision);
    },
    [identity, projectId, revision],
  );
  const commit = useCallback(
    (next: EditorState) => {
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
    (command: EditCommand) => {
      const next = executeCommand(stateRef.current, command);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        commit(next);
      }
    },
    [commit],
  );
  const save = useCallback(async () => {
    if (inFlight.current || conflict || !dirty) return;
    inFlight.current = true;
    setSaving(true);
    try {
      if (!pending.current)
        pending.current = {
          uuid: crypto.randomUUID(),
          seq: sequence.current,
          base: revision,
          xml: serializeStudioTtml(stateRef.current.present.document, {
            draft: true,
          }),
        };
      const request = pending.current;
      const result = await saveDocument(
        request.xml,
        request.base,
        request.uuid,
        request.seq,
        etag,
      );
      setRevision(result.revision);
      setEtag(result.etag);
      setError(null);
      pending.current = null;
      if (sequence.current === request.seq) {
        setDirty(false);
        await createRecoveryAdapter().clear(projectId);
      } else {
        await createRecoveryAdapter().save(
          projectId,
          identity,
          stateRef.current,
          result.revision,
        );
      }
    } catch (caught) {
      if ((caught as { status?: number }).status === 412) setConflict(true);
      setError(
        caught instanceof Error ? caught.message : "保存失败，修改已保留",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [conflict, dirty, etag, identity, projectId, revision, saveDocument]);
  useEffect(() => {
    if (!dirty || error || conflict) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, error, save]);
  const history = useCallback(
    (change: (s: EditorState) => EditorState) => {
      if (conflict) return;
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
    (command: EditCommand) => {
      if (conflict) return false;
      dispatch(command);
      return true;
    },
    [conflict, dispatch],
  );
  const recover = useCallback(async () => {
    const adapter = createRecoveryAdapter();
    const record = await adapter.readCheckpoint(projectId);
    const recovered = await adapter.load(projectId, identity);
    if (recovered) {
      stateRef.current = recovered;
      setState(recovered);
      ++sequence.current;
      setDirty(true);
      if (record?.baseRevision && record.baseRevision !== revision)
        setConflict(true);
      return true;
    }
    return false;
  }, [identity, projectId, revision]);
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
    await createRecoveryAdapter().discard(projectId);
    setRecovery({ available: false });
  }, [projectId]);
  const restore = useCallback(async () => {
    const ok = await recover();
    if (ok) setRecovery({ available: false });
    return ok;
  }, [recover]);
  return {
    document: state.present.document as StudioLyricDocument,
    state,
    revision,
    dirty,
    saving,
    conflict,
    error,
    recovery,
    apply,
    save,
    recover: restore,
    restore,
    discardRecovery,
    reloadRecovery: recover,
    undo: () => history(undo),
    redo: () => history(redo),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    clearConflict: () => setConflict(false),
  };
}
