import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '../adapters/http/jobs';
import { isBrowserRuntime } from '../adapters/runtime';
import type { JobsResponse } from '../adapters/http/jobs';

export function useProjectJobs(projectId: string, visible: boolean) {
  const query = useQuery({
    queryKey: ['vocal-jobs', projectId],
    queryFn: (): Promise<JobsResponse> => isBrowserRuntime ? Promise.resolve({ schema_version: 'studio-job-list-v1', items: [] }) : jobsApi.list(projectId),
    enabled: !isBrowserRuntime,
    initialData: isBrowserRuntime ? { schema_version: 'studio-job-list-v1', items: [] } : undefined,
    refetchInterval: (state) =>
      state.state.data?.items.some((job) => ['queued', 'running', 'cancel_requested'].includes(job.status))
        ? 700
        : 15000,
    refetchOnWindowFocus: 'always',
  });
  useEffect(() => {
    if (visible && !isBrowserRuntime) void query.refetch();
  }, [projectId, visible]);
  return query;
}
