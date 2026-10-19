import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '../adapters/http/jobs';

export function useProjectJobs(projectId: string, visible: boolean) {
  const query = useQuery({
    queryKey: ['vocal-jobs', projectId], queryFn: () => jobsApi.list(projectId),
    refetchInterval: state => state.state.data?.items.some(job => ['queued','running','cancel_requested'].includes(job.status)) ? 1000 : 15000,
    refetchOnWindowFocus: 'always',
  });
  useEffect(() => { if (visible) void query.refetch(); }, [projectId, visible]);
  return query;
}
