import { useCallback, useEffect, useRef, useState } from "react";
import { createRecoveryAdapter } from "../adapters/recovery";
import { parseLyricTtml, serializeLyricTtml } from "../adapters/ttml/lyric-codec";
import {
  createLyricEditorState,
  executeLyricCommand,
  redoLyricCommand,
  undoLyricCommand,
  type LyricCommand,
  type LyricEditorState,
} from "../domain/lyric-commands";

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
  const [state, setState] = useState<LyricEditorState>(() =>
    createLyricEditorState(parseLyricTtml(initialTtml)),
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
  const recoveryQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueRecovery = useCallback((operation: () => Promise<void>) => {
    const next = recoveryQueue.current.catch(() => undefined).then(operation);
    recoveryQueue.current = next;
    return next;
  }, []);
  const checkpoint = useCallback(
    async (next: LyricEditorState) => {
      await enqueueRecovery(() => createRecoveryAdapter().save(projectId, identity, next, revision));
    },
    [enqueueRecovery, identity, projectId, revision],
  );
  const commit = useCallback(
    (next: LyricEditorState) => {
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
      const next = executeLyricCommand(stateRef.current, command);
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
          xml: serializeLyricTtml(stateRef.current.present, {
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
        await enqueueRecovery(() => createRecoveryAdapter().clear(projectId));
        setRecovery({ available: false });
      } else {
        await enqueueRecovery(() => createRecoveryAdapter().save(
          projectId,
          identity,
          stateRef.current,
          result.revision,
        ));
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
  }, [conflict, dirty, enqueueRecovery, etag, identity, projectId, revision, saveDocument]);
  useEffect(() => {
    if (!dirty || error || conflict) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, error, save]);
  const history = useCallback(
    (change: (s: LyricEditorState) => LyricEditorState) => {
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
    (command: LyricCommand) => {
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
    await enqueueRecovery(() => createRecoveryAdapter().discard(projectId));
    setRecovery({ available: false });
  }, [enqueueRecovery, projectId]);
  const restore = useCallback(async () => {
    const ok = await recover();
    if (ok) setRecovery({ available: false });
    return ok;
  }, [recover]);
  return {
    document: state.present,
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
    undo: () => history(undoLyricCommand),
    redo: () => history(redoLyricCommand),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    clearConflict: () => setConflict(false),
  };
}
