import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alignmentApi } from '../adapters/http/alignment';
import { vocalApi } from '../adapters/http/client';
import { jobsApi, type Job } from '../adapters/http/jobs';
import type { AlignmentResult } from '../domain/alignment';
import { createLyricDocument, createWord } from '../domain/lyric-document';
import { createProjectDocument, type ProjectCommand, type ProjectDocument } from '../domain/project-document';
import { useBackgroundJobRecovery } from './useBackgroundJobRecovery';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeProjectWithLine(beginMs: number | null = null, endMs: number | null = null): ProjectDocument {
  const lyrics = createLyricDocument('');
  lyrics.lines[0] = {
    ...lyrics.lines[0],
    id: 'l1',
    beginMs,
    endMs,
    words: [{ ...createWord('Hello', 'w1'), beginMs, endMs }],
  };
  return createProjectDocument(lyrics);
}

function makeAlignmentJob(overrides: Partial<Job> = {}): Job {
  return {
    schema_version: 'studio-job-v1',
    id: 'job-align-1',
    project_id: 'p1',
    kind: 'alignment',
    status: 'succeeded',
    stage: 'done',
    acknowledged_state: null,
    request: { revision: 'rev-1', asset_id: 'a1' },
    result_available: true,
    error: null,
    ...overrides,
  };
}

function makeVocalJob(overrides: Partial<Job> = {}): Job {
  return {
    schema_version: 'studio-job-v1',
    id: 'job-vocal-1',
    project_id: 'p1',
    kind: 'vocal',
    status: 'succeeded',
    stage: 'done',
    acknowledged_state: null,
    request: { asset_id: 'a1' },
    result_available: true,
    error: null,
    ...overrides,
  };
}

describe('useBackgroundJobRecovery', () => {
  it('recovers unacknowledged succeeded alignment job on matching revision and applies cleanly', async () => {
    const project = makeProjectWithLine();
    const fakeResult: AlignmentResult = {
      kind: 'alignment',
      binding: { project_id: 'p1', revision: 'rev-1', asset_id: 'a1' },
      alignment: {
        schema: 'lazulite-japanese-result-v1',
        units: [{ unit_id: 'u1', line_id: 'l1', proposed_timing: { start: { time: 0.5, source: 'm' }, end: { time: 1.2, source: 'm' } } }],
      },
      mapping: [{ unit_id: 'u1', object_id: 'w1', word_id: 'w1', line_id: 'l1', kind: 'word' }],
      scope: [{ object_id: 'w1', word_id: 'w1', line_id: 'l1', kind: 'word', target_ids: ['u1'] }],
      acoustics: null,
    };

    vi.spyOn(alignmentApi, 'result').mockResolvedValue(fakeResult);
    const ackSpy = vi.spyOn(jobsApi, 'acknowledge').mockResolvedValue(makeAlignmentJob({ acknowledged_state: 'applied' }));

    let currentProject = project;
    const lockApply = vi.fn((next: ProjectDocument) => {
      currentProject = next;
    });
    const saveForPackaging = vi.fn().mockResolvedValue({ revision: 'rev-2' });
    const onNotice = vi.fn();

    const { result } = renderHook(
      () =>
        useBackgroundJobRecovery({
          projectId: 'p1',
          sourceAssetId: 'a1',
          durationMs: 10000,
          revision: 'rev-1',
          dirty: false,
          conflict: false,
          editingLocked: false,
          project: currentProject,
          jobs: [makeAlignmentJob()],
          claimedJobIds: new Set(),
          lockEditing: () => ({ source: currentProject, apply: lockApply, release: vi.fn() }),
          saveForPackaging,
          applyProject: vi.fn(),
          requestAlignmentOpen: vi.fn(),
          onNotice,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.alignmentPrompt?.kind).toBe('ready');
    });

    await act(async () => {
      await result.current.applyAlignment();
    });

    expect(lockApply).toHaveBeenCalledTimes(1);
    expect(currentProject.lyrics.lines[0]).toMatchObject({ beginMs: 500, endMs: 1200 });
    expect(saveForPackaging).toHaveBeenCalledTimes(1);
    expect(ackSpy).toHaveBeenCalledWith('job-align-1', 'applied');
    expect(result.current.alignmentPrompt).toBeNull();
    expect(onNotice).toHaveBeenCalled();
  });

  it('flags stale alignment results when revision changed and supports re-run dismissal', async () => {
    const project = makeProjectWithLine();
    vi.spyOn(alignmentApi, 'result').mockResolvedValue({
      kind: 'alignment',
      binding: { project_id: 'p1', revision: 'rev-1', asset_id: 'a1' },
      alignment: { schema: 'lazulite-japanese-result-v1', units: [] },
      mapping: [],
      scope: [],
      acoustics: null,
    });
    const ackSpy = vi.spyOn(jobsApi, 'acknowledge').mockResolvedValue(makeAlignmentJob({ acknowledged_state: 'dismissed' }));
    const requestAlignmentOpen = vi.fn();

    const { result } = renderHook(
      () =>
        useBackgroundJobRecovery({
          projectId: 'p1',
          sourceAssetId: 'a1',
          durationMs: 10000,
          revision: 'rev-2',
          dirty: false,
          conflict: false,
          editingLocked: false,
          project,
          jobs: [makeAlignmentJob()],
          claimedJobIds: new Set(),
          lockEditing: () => ({ source: project, apply: vi.fn(), release: vi.fn() }),
          saveForPackaging: vi.fn(),
          applyProject: vi.fn(),
          requestAlignmentOpen,
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.alignmentPrompt?.kind).toBe('stale');
    });

    await act(async () => {
      await result.current.rerunAlignment();
    });
    expect(ackSpy).toHaveBeenCalledWith('job-align-1', 'dismissed');
    expect(requestAlignmentOpen).toHaveBeenCalledTimes(1);
    expect(result.current.alignmentPrompt).toBeNull();
  });

  it('auto-applies unconflicted background vocal results and prompts on conflict', async () => {
    const emptyProject = makeProjectWithLine();
    vi.spyOn(vocalApi, 'jobResult').mockResolvedValue({ kind: 'vocal', analysis_id: 'voc-1' });
    vi.spyOn(vocalApi, 'list').mockResolvedValue({
      items: [
        {
          id: 'voc-1',
          project_id: 'p1',
          source_asset_id: 'a1',
          audio_state: 'current',
          source_kind: 'separated',
          status: 'ready',
          segments: [{ id: 's1', beginMs: 100, endMs: 2000, confidence: 0.9 }],
        },
      ],
    } as never);
    const ackSpy = vi.spyOn(jobsApi, 'acknowledge').mockResolvedValue(makeVocalJob({ acknowledged_state: 'applied' }));
    const applyProject = vi.fn<(cmd: ProjectCommand) => void>();
    const onNotice = vi.fn();

    const { unmount } = renderHook(
      () =>
        useBackgroundJobRecovery({
          projectId: 'p1',
          sourceAssetId: 'a1',
          durationMs: 10000,
          revision: 'rev-1',
          dirty: false,
          conflict: false,
          editingLocked: false,
          project: emptyProject,
          jobs: [makeVocalJob()],
          claimedJobIds: new Set(),
          lockEditing: () => ({ source: emptyProject, apply: vi.fn(), release: vi.fn() }),
          saveForPackaging: vi.fn(),
          applyProject,
          requestAlignmentOpen: vi.fn(),
          onNotice,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(applyProject).toHaveBeenCalledWith({
        type: 'acoustics',
        acoustics: { analysisId: 'voc-1', segments: [{ id: 's1', beginMs: 100, endMs: 2000, confidence: 0.9 }] },
      });
    });
    expect(ackSpy).toHaveBeenCalledWith('job-vocal-1', 'applied');
    expect(onNotice).toHaveBeenCalled();
    unmount();

    // Now test conflict case when manual segments exist
    const existingProject: ProjectDocument = {
      ...emptyProject,
      acoustics: { analysisId: null, segments: [{ id: 'manual-1', beginMs: 50, endMs: 500 }] },
    };
    const ackDismissSpy = vi.spyOn(jobsApi, 'acknowledge').mockResolvedValue(makeVocalJob({ acknowledged_state: 'dismissed' }));
    const { result: conflictHook } = renderHook(
      () =>
        useBackgroundJobRecovery({
          projectId: 'p1',
          sourceAssetId: 'a1',
          durationMs: 10000,
          revision: 'rev-1',
          dirty: false,
          conflict: false,
          editingLocked: false,
          project: existingProject,
          jobs: [makeVocalJob()],
          claimedJobIds: new Set(),
          lockEditing: () => ({ source: existingProject, apply: vi.fn(), release: vi.fn() }),
          saveForPackaging: vi.fn(),
          applyProject: vi.fn(),
          requestAlignmentOpen: vi.fn(),
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(conflictHook.current.vocalConflictPrompt?.matchedId).toBe('voc-1');
    });

    await act(async () => {
      await conflictHook.current.dismissVocal();
    });
    expect(ackDismissSpy).toHaveBeenCalledWith('job-vocal-1', 'dismissed');
    expect(conflictHook.current.vocalConflictPrompt).toBeNull();
  });

  it('tracks external MCP alignment acknowledgement transitions without claiming', () => {
    const project = makeProjectWithLine();
    const { result, rerender } = renderHook(
      ({ jobs, rev }: { jobs: Job[]; rev: string }) =>
        useBackgroundJobRecovery({
          projectId: 'p1',
          sourceAssetId: 'a1',
          durationMs: 10000,
          revision: rev,
          dirty: false,
          conflict: false,
          editingLocked: false,
          project,
          jobs,
          claimedJobIds: new Set(),
          lockEditing: () => ({ source: project, apply: vi.fn(), release: vi.fn() }),
          saveForPackaging: vi.fn(),
          applyProject: vi.fn(),
          requestAlignmentOpen: vi.fn(),
          onNotice: vi.fn(),
        }),
      {
        wrapper: createWrapper(),
        initialProps: { jobs: [makeAlignmentJob({ status: 'running', result_available: false })], rev: 'rev-1' },
      },
    );

    expect(result.current.externalAlignmentApplied).toBe(false);

    rerender({
      jobs: [makeAlignmentJob({ status: 'succeeded', acknowledged_state: 'applied' })],
      rev: 'rev-2',
    });

    expect(result.current.externalAlignmentApplied).toBe(true);
  });
});
