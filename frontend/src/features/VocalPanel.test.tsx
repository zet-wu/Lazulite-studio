import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vocalApi } from '../adapters/http/client';
import { jobsApi, type Job } from '../adapters/http/jobs';
import { scopedSessionKey } from '../adapters/preferences';
import { createLyricDocument } from '../domain/lyric-document';
import { createProjectDocument, type ProjectCommand } from '../domain/project-document';
import { AudioReviewProvider } from './AudioReviewContext';
import { FloatingTrayProvider } from './FloatingTray';
import { VocalPanel } from './VocalPanel';

function makeVocalJob(overrides: Partial<Job> = {}): Job {
  return {
    schema_version: 'studio-job-v1',
    id: 'job-vocal-panel-1',
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

describe('VocalPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('waits for document save before acknowledging applied vocal result and retries after save failure', async () => {
    const initial = createProjectDocument(createLyricDocument(''));
    sessionStorage.setItem(
      scopedSessionKey('studio-vocal-intent-v1:p1'),
      JSON.stringify({ id: 'job-vocal-panel-1', baseline: JSON.stringify(initial.acoustics) }),
    );

    vi.spyOn(jobsApi, 'list').mockResolvedValue({ schema_version: 'studio-job-list-v1', items: [makeVocalJob()] });
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
    const save = vi.fn().mockRejectedValueOnce(new Error('503 Service Unavailable')).mockResolvedValueOnce({ revision: 'r2' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const [project, setProject] = useState(initial);
      const apply = (cmd: ProjectCommand) => {
        if (cmd.type === 'acoustics') setProject((prev) => ({ ...prev, acoustics: cmd.acoustics }));
      };
      return (
        <QueryClientProvider client={client}>
          <AudioReviewProvider>
            <FloatingTrayProvider>
              <VocalPanel
                projectId="p1"
                project={project}
                sourceAssetId="a1"
                apply={apply}
                save={save}
                durationMs={10000}
                visible={true}
              />
            </FloatingTrayProvider>
          </AudioReviewProvider>
        </QueryClientProvider>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(ackSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(scopedSessionKey('studio-vocal-intent-v1:p1'))).toBeTruthy();

    const retryBtn = await screen.findByRole('button', { name: '重试人声处理' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(ackSpy).toHaveBeenCalledWith('job-vocal-panel-1', 'applied');
    });
    await waitFor(() => {
      expect(sessionStorage.getItem(scopedSessionKey('studio-vocal-intent-v1:p1'))).toBeNull();
    });
  });
});
