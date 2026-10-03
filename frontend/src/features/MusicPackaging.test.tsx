import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPackaging } from './MusicPackaging';
import { publishingApi } from '../adapters/http/publishing';
import { createLyricDocument } from '../domain/lyric-document';
vi.mock('../adapters/http/publishing', () => ({ publishingApi: { list: vi.fn(), publish: vi.fn() } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('download follows the last available success through active, failed and cancelled tasks, and disables without a valid record', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ filename:'song.flac', format_label:'FLAC', asset_id:'source', supported:true, container:'flac', tracks:[], error:null })));
  const client = new QueryClient({ defaultOptions: { queries: { retry:false } } });
  const document = createLyricDocument('歌'), onIssues=vi.fn(), save=vi.fn();
  let items: any[] = [];
  vi.mocked(publishingApi.list).mockImplementation(async () => ({items}) as any);
  render(<QueryClientProvider client={client}><MusicPackaging projectId="downloads" document={document} saveForPackaging={save} onIssues={onIssues} dirty /></QueryClientProvider>);
  await expect(screen.findByRole('button', { name:'下载产物' })).resolves.toBeDisabled();
  const success={id:'old',status:'succeeded',download_url:'/old.flac',revision:'r1',stale:true,lrc_kind:'lrc',report:{passed:true,lyrics_preserved:true}};
  for (const status of ['running','failed','cancelled']) {
    items=[{id:'new',status,revision:'r2',lrc_kind:'lrc'},success];
    await client.invalidateQueries({queryKey:['exports','downloads']});
    await waitFor(() => expect(screen.getByRole('link',{name:'下载产物'})).toHaveAttribute('href','/old.flac'));
    expect(screen.getByText(/旧修订/)).toBeVisible();
    expect(screen.getByText(/此产物不包含这些修改/)).toBeVisible();
    expect(screen.queryByRole('link',{name:'下载音乐文件'})).toBeNull();
  }
  items=[{...success,status:'unavailable',download_url:null}];
  await client.invalidateQueries({queryKey:['exports','downloads']});
  await waitFor(() => expect(screen.getByRole('button',{name:'下载产物'})).toBeDisabled());
  expect(save).not.toHaveBeenCalled(); expect(publishingApi.publish).not.toHaveBeenCalled();
  client.clear();
});
