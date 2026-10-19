import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { jobsApi } from '../adapters/http/jobs';
import { useProjectJobs } from './useProjectJobs';

it('polls active work more often and refreshes on focus and reentry', async () => {
  vi.useFakeTimers();
  let active = false;
  const list = vi.spyOn(jobsApi, 'list').mockImplementation(async () => ({schema_version:'studio-job-list-v1',items:active?[{id:'job',kind:'vocal',status:'running'}]:[]}));
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const wrapper = ({children}:{children:ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({visible})=>useProjectJobs('p',visible),{wrapper,initialProps:{visible:false}});
  const advance = async (ms:number) => { await act(async()=>{await vi.advanceTimersByTimeAsync(ms);}); };
  try {
    await advance(1);
    const idleStart=list.mock.calls.length; await advance(4000); const idle=list.mock.calls.length-idleStart;
    active=true;
    await act(async()=>{focusManager.setFocused(false);focusManager.setFocused(true);}); await advance(1);
    expect(hook.result.current.data?.items[0]?.status).toBe('running');
    const activeStart=list.mock.calls.length; await advance(4000); const activeCount=list.mock.calls.length-activeStart; expect(activeCount).toBeGreaterThan(idle);
    active=false; await act(async()=>{await hook.result.current.refetch();}); await advance(1);
    const ended=list.mock.calls.length; await advance(4000); expect(list.mock.calls.length-ended).toBeLessThan(activeCount);
    const beforeEntry=list.mock.calls.length; hook.rerender({visible:true}); await advance(1);
    expect(list.mock.calls.length).toBeGreaterThan(beforeEntry);
  } finally {hook.unmount();client.clear();focusManager.setFocused(undefined);list.mockRestore();vi.useRealTimers();}
});
