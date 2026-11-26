import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isBrowserRuntime } from '../adapters/runtime';
import { alignmentApi } from '../adapters/http/alignment';
import { vocalApi } from '../adapters/http/client';
import { jobsApi, type Job } from '../adapters/http/jobs';
import { mergeAlignment, type AlignmentResult } from '../domain/alignment';
import { errorMessage, message as describeMessage, messageList, type Message } from '../domain/messages';
import type { Acoustics, ProjectCommand, ProjectDocument } from '../domain/project-document';
import { intersectSegments } from '../domain/time-boundaries';
import { taskError } from './task-messages';

export type BackgroundAlignmentPrompt =
  | { kind: 'ready'; job: Job; result: AlignmentResult }
  | { kind: 'dirty'; job: Job }
  | { kind: 'stale'; job: Job };

export type BackgroundVocalPrompt = {
  job: Job;
  matchedId: string;
  segments: Acoustics['segments'];
};

export type BackgroundFailurePrompt = {
  job: Job;
  message: Message;
};

type UseBackgroundJobRecoveryArgs = {
  projectId: string;
  sourceAssetId: string | null;
  durationMs: number | null;
  revision: string;
  dirty: boolean;
  conflict: boolean;
  editingLocked: boolean;
  project: ProjectDocument;
  jobs: Job[] | undefined;
  claimedJobIds: ReadonlySet<string>;
  lockEditing: () => {
    source: ProjectDocument;
    apply: (project: ProjectDocument) => void;
    release: () => void;
  };
  saveForPackaging: () => Promise<unknown>;
  applyProject: (command: ProjectCommand) => void;
  requestAlignmentOpen: () => void;
  onNotice: (text: string | Message | null, role?: 'status' | 'alert', durationMs?: number) => void;
};

export function useBackgroundJobRecovery({
  projectId,
  sourceAssetId,
  durationMs,
  revision,
  dirty,
  conflict,
  editingLocked,
  project,
  jobs,
  claimedJobIds: claimedIds,
  lockEditing,
  saveForPackaging,
  applyProject,
  requestAlignmentOpen,
  onNotice,
}: UseBackgroundJobRecoveryArgs) {
  const queryClient = useQueryClient();
  const [applyingAlignment, setApplyingAlignment] = useState(false);
  const [busyVocal, setBusyVocal] = useState(false);
  const [externalAlignmentRevision, setExternalAlignmentRevision] = useState<string | null>(null);
  const locallyHandledIds = useRef(new Set<string>());
  const autoApplyingVocalRef = useRef(false);
  const failedAutoVocalIds = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const [handledVersion, setHandledVersion] = useState(0);
  const seenJobs = useRef(new Map<string, { status: string; acknowledgedState: string | null }>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markHandled = useCallback((jobId: string) => {
    locallyHandledIds.current.add(jobId);
    setHandledVersion((v) => v + 1);
  }, []);

  // Track external MCP `apply_alignment_result` acknowledgement transitions in-session
  useEffect(() => {
    if (!jobs) return;
    for (const job of jobs) {
      const prev = seenJobs.current.get(job.id);
      const ack = job.acknowledged_state ?? null;
      seenJobs.current.set(job.id, { status: job.status, acknowledgedState: ack });
      if (
        job.kind === 'alignment' &&
        ack === 'applied' &&
        prev &&
        prev.acknowledgedState !== 'applied' &&
        !claimedIds.has(job.id) &&
        !locallyHandledIds.current.has(job.id)
      ) {
        setExternalAlignmentRevision(revision);
      }
    }
  }, [jobs, claimedIds, revision]);

  const latestAlignment = useMemo(
    () => jobs?.find((job) => job.kind === 'alignment'),
    [jobs],
  );
  const alignmentNeedsRecovery = Boolean(
    latestAlignment &&
      latestAlignment.status === 'succeeded' &&
      latestAlignment.result_available &&
      !latestAlignment.acknowledged_state &&
      !claimedIds.has(latestAlignment.id) &&
      !locallyHandledIds.current.has(latestAlignment.id),
  );

  const alignmentResultQuery = useQuery({
    queryKey: ['recovery-alignment-result', latestAlignment?.id],
    queryFn: () => alignmentApi.result(latestAlignment!.id),
    enabled: !isBrowserRuntime && alignmentNeedsRecovery,
  });

  const alignmentPrompt = useMemo<BackgroundAlignmentPrompt | null>(() => {
    void handledVersion;
    if (!alignmentNeedsRecovery || !latestAlignment || !alignmentResultQuery.data) return null;
    if (locallyHandledIds.current.has(latestAlignment.id)) return null;
    const result = alignmentResultQuery.data;
    const matchesBinding =
      result.binding.project_id === projectId &&
      result.binding.asset_id === sourceAssetId &&
      result.binding.revision === revision;
    if (!matchesBinding) return { kind: 'stale', job: latestAlignment };
    if (dirty || conflict || editingLocked || durationMs === null) {
      return { kind: 'dirty', job: latestAlignment };
    }
    return { kind: 'ready', job: latestAlignment, result };
  }, [
    alignmentNeedsRecovery,
    latestAlignment,
    alignmentResultQuery.data,
    projectId,
    sourceAssetId,
    revision,
    dirty,
    conflict,
    editingLocked,
    durationMs,
    handledVersion,
  ]);

  const applyAlignment = useCallback(async () => {
    if (!alignmentPrompt || alignmentPrompt.kind !== 'ready' || applyingAlignment || durationMs === null) {
      return;
    }
    const { job, result } = alignmentPrompt;
    setApplyingAlignment(true);
    try {
      const req = (job.request ?? {}) as Record<string, unknown>;
      const clearUnmatched = Boolean(req.clear_unmatched);
      const mergeShortGaps = Boolean(req.merge_short_gaps);
      const rawThreshold = Number(req.gap_threshold_ms);
      const gapThreshold =
        mergeShortGaps && Number.isSafeInteger(rawThreshold) && rawThreshold > 0
          ? rawThreshold
          : mergeShortGaps
            ? 500
            : null;
      const lock = lockEditing();
      let merged;
      try {
        merged = mergeAlignment(lock.source, result, durationMs, clearUnmatched, gapThreshold);
        lock.apply(merged.project);
      } finally {
        lock.release();
      }
      await saveForPackaging();
      markHandled(job.id);
      await jobsApi.acknowledge(job.id, 'applied').catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
      onNotice(
        messageList([
          ...(result.normalization && (result.normalization.clipped || result.normalization.dropped)
            ? [
                describeMessage('task.normalized', {
                  clipped: result.normalization.clipped,
                  dropped: result.normalization.dropped,
                }),
              ]
            : []),
          describeMessage(merged.project === lock.source ? 'alignment.noChanges' : 'alignment.updated'),
          ...(merged.mergedGaps ? [describeMessage('alignment.mergedGaps', { count: merged.mergedGaps })] : []),
          ...(merged.cleared.length ? [describeMessage('alignment.cleared', { count: merged.cleared.length })] : []),
          ...(merged.retained.length ? [describeMessage('alignment.retained', { count: merged.retained.length })] : []),
        ]),
        'status',
        merged.retained.length || merged.cleared.length ? 8000 : 4000,
      );
    } catch (cause) {
      onNotice(errorMessage(cause), 'alert');
    } finally {
      setApplyingAlignment(false);
    }
  }, [alignmentPrompt, applyingAlignment, durationMs, lockEditing, saveForPackaging, markHandled, queryClient, projectId, onNotice]);

  const dismissAlignment = useCallback(async () => {
    if (!alignmentPrompt) return;
    const jobId = alignmentPrompt.job.id;
    markHandled(jobId);
    await jobsApi.acknowledge(jobId, 'dismissed').catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
  }, [alignmentPrompt, markHandled, queryClient, projectId]);

  const rerunAlignment = useCallback(async () => {
    await dismissAlignment();
    requestAlignmentOpen();
  }, [dismissAlignment, requestAlignmentOpen]);

  // Background vocal separation recovery (only when VocalPanel `sessionStorage` did not claim the job)
  const latestVocal = useMemo(
    () => jobs?.find((job) => job.kind === 'vocal'),
    [jobs],
  );
  const vocalNeedsRecovery = Boolean(
    latestVocal &&
      latestVocal.status === 'succeeded' &&
      !latestVocal.acknowledged_state &&
      !claimedIds.has(latestVocal.id) &&
      !locallyHandledIds.current.has(latestVocal.id),
  );

  const vocalJobResultQuery = useQuery({
    queryKey: ['recovery-vocal-result', latestVocal?.id],
    queryFn: () => vocalApi.jobResult(latestVocal!.id),
    enabled: !isBrowserRuntime && vocalNeedsRecovery,
  });
  const vocalsListQuery = useQuery({
    queryKey: ['vocals', projectId],
    queryFn: () => vocalApi.list(projectId),
    enabled: !isBrowserRuntime && vocalNeedsRecovery,
  });

  const [dismissedVocalIds, setDismissedVocalIds] = useState<string[]>([]);

  // Auto-apply only when no conflict exists; prompt is derived cleanly without state loops.
  useEffect(() => {
    if (!vocalNeedsRecovery || !latestVocal || !vocalJobResultQuery.data || !vocalsListQuery.data) return;
    if (locallyHandledIds.current.has(latestVocal.id) || autoApplyingVocalRef.current) return;
    const analysisId = vocalJobResultQuery.data.analysis_id;
    const matched = vocalsListQuery.data.items.find((item) => item.id === analysisId);
    if (!matched || matched.source_asset_id !== sourceAssetId || matched.status !== 'ready') {
      markHandled(latestVocal.id);
      void jobsApi.acknowledge(latestVocal.id, 'dismissed').catch(() => undefined);
      return;
    }
    if (project.acoustics.analysisId === matched.id && !dirty) {
      markHandled(latestVocal.id);
      void jobsApi.acknowledge(latestVocal.id, 'applied').catch(() => undefined);
      return;
    }
    if (project.acoustics.analysisId === matched.id || failedAutoVocalIds.current.has(latestVocal.id)) return;
    if (durationMs === null || conflict || editingLocked) return;

    const hasExisting = Boolean(project.acoustics.analysisId || project.acoustics.segments.length > 0);
    if (hasExisting) return;

    const normalized = intersectSegments(matched.segments ?? [], durationMs);
    const jobId = latestVocal.id;
    autoApplyingVocalRef.current = true;
    void (async () => {
      try {
        applyProject({ type: 'acoustics', acoustics: { analysisId: matched.id, segments: normalized.segments } });
        await saveForPackaging();
        markHandled(jobId);
        await jobsApi.acknowledge(jobId, 'applied').catch(() => undefined);
        await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
        if (mountedRef.current) {
          onNotice(describeMessage('vocal.backgroundApplied'), 'status', 4000);
        }
      } catch (cause) {
        failedAutoVocalIds.current.add(jobId);
        if (mountedRef.current) {
          onNotice(errorMessage(cause), 'alert');
        }
      } finally {
        autoApplyingVocalRef.current = false;
      }
    })();
  }, [
    vocalNeedsRecovery,
    latestVocal,
    vocalJobResultQuery.data,
    vocalsListQuery.data,
    sourceAssetId,
    project.acoustics.analysisId,
    project.acoustics.segments.length,
    dirty,
    durationMs,
    conflict,
    editingLocked,
    markHandled,
    applyProject,
    saveForPackaging,
    queryClient,
    projectId,
    onNotice,
  ]);

  const vocalConflictPrompt = useMemo<BackgroundVocalPrompt | null>(() => {
    void handledVersion;
    if (!vocalNeedsRecovery || !latestVocal || !vocalJobResultQuery.data || !vocalsListQuery.data) return null;
    if (locallyHandledIds.current.has(latestVocal.id) || dismissedVocalIds.includes(latestVocal.id)) return null;
    const analysisId = vocalJobResultQuery.data.analysis_id;
    const matched = vocalsListQuery.data.items.find((item) => item.id === analysisId);
    if (!matched || matched.source_asset_id !== sourceAssetId || matched.status !== 'ready') return null;
    if (project.acoustics.analysisId === matched.id) return null;
    if (durationMs === null || conflict || editingLocked) return null;
    const hasExisting = Boolean(project.acoustics.analysisId || project.acoustics.segments.length > 0);
    if (!hasExisting) return null;
    return {
      job: latestVocal,
      matchedId: matched.id,
      segments: intersectSegments(matched.segments ?? [], durationMs).segments,
    };
  }, [
    handledVersion,
    vocalNeedsRecovery,
    latestVocal,
    vocalJobResultQuery.data,
    vocalsListQuery.data,
    dismissedVocalIds,
    sourceAssetId,
    project.acoustics.analysisId,
    project.acoustics.segments.length,
    durationMs,
    conflict,
    editingLocked,
  ]);

  const adoptVocal = useCallback(async () => {
    if (!vocalConflictPrompt || busyVocal) return;
    setBusyVocal(true);
    try {
      applyProject({
        type: 'acoustics',
        acoustics: { analysisId: vocalConflictPrompt.matchedId, segments: vocalConflictPrompt.segments },
      });
      await saveForPackaging();
      markHandled(vocalConflictPrompt.job.id);
      setDismissedVocalIds((ids) => [...ids, vocalConflictPrompt.job.id]);
      await jobsApi.acknowledge(vocalConflictPrompt.job.id, 'applied').catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
      onNotice(describeMessage('vocal.completed'), 'status', 4000);
    } catch (cause) {
      onNotice(errorMessage(cause), 'alert');
    } finally {
      setBusyVocal(false);
    }
  }, [vocalConflictPrompt, busyVocal, applyProject, saveForPackaging, markHandled, queryClient, projectId, onNotice]);

  const dismissVocal = useCallback(async () => {
    if (!vocalConflictPrompt) return;
    const jobId = vocalConflictPrompt.job.id;
    markHandled(jobId);
    setDismissedVocalIds((ids) => [...ids, jobId]);
    await jobsApi.acknowledge(jobId, 'dismissed').catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
  }, [vocalConflictPrompt, markHandled, queryClient, projectId]);

  // Recover unacknowledged failed / interrupted background jobs across reload (only latest job per kind)
  const failurePrompt = useMemo<BackgroundFailurePrompt | null>(() => {
    void handledVersion;
    const candidates = [latestAlignment, latestVocal].filter(
      (job): job is Job =>
        Boolean(
          job &&
            (job.status === 'failed' || job.status === 'interrupted') &&
            !job.acknowledged_state &&
            !claimedIds.has(job.id) &&
            !locallyHandledIds.current.has(job.id),
        ),
    );
    const latestFailure = candidates[0];
    if (!latestFailure) return null;
    const msg = latestFailure.error
      ? taskError(latestFailure.error)
      : describeMessage(latestFailure.kind === 'vocal' ? 'vocal.failed' : 'task.interruptedRetry');
    return { job: latestFailure, message: msg };
  }, [latestAlignment, latestVocal, claimedIds, handledVersion]);

  const dismissFailure = useCallback(async () => {
    if (!failurePrompt) return;
    const jobId = failurePrompt.job.id;
    markHandled(jobId);
    await jobsApi.acknowledge(jobId, 'dismissed').catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', projectId] });
  }, [failurePrompt, markHandled, queryClient, projectId]);

  return {
    externalAlignmentApplied: externalAlignmentRevision !== null && externalAlignmentRevision === revision,
    alignmentPrompt,
    applyingAlignment,
    applyAlignment,
    dismissAlignment,
    rerunAlignment,
    vocalConflictPrompt,
    busyVocal,
    adoptVocal,
    dismissVocal,
    failurePrompt,
    dismissFailure,
  };
}
