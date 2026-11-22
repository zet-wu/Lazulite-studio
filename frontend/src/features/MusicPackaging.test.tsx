import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPackaging } from './MusicPackaging';
import { publishingApi } from '../adapters/http/publishing';
import { createLyricDocument } from '../domain/lyric-document';

vi.mock('../adapters/http/publishing', () => ({
  publishingApi: {
    info: vi.fn(),
    download: vi.fn(),
  },
}));
vi.mock('../shared/download', () => ({
  downloadBlob: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('shows container-appropriate dropdowns, blocks both-none and forces save before direct download', async () => {
  vi.mocked(publishingApi.info).mockResolvedValue({
    filename: 'song.m4a',
    format_label: 'M4A',
    asset_id: 'asset-1',
    supported: true,
    container: 'mp4',
    tracks: [{ track_id: 2, language: 'und', name: 'Lazulite TTML' }],
    error: null,
  });
  vi.mocked(publishingApi.download).mockResolvedValue({
    blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/mp4' }),
    filename: 'song.m4a',
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const document = createLyricDocument('歌');
  document.lines[0].beginMs = 0;
  document.lines[0].endMs = 1000;
  document.lines[0].words[0].beginMs = 0;
  document.lines[0].words[0].endMs = 1000;
  const onIssues = vi.fn();
  const save = vi.fn(async () => ({ revision: 'rev-secret-123', document }));

  render(
    <QueryClientProvider client={client}>
      <MusicPackaging projectId="p1" document={document} saveForPackaging={save} onIssues={onIssues} />
    </QueryClientProvider>,
  );

  const stppSelect = await screen.findByRole('combobox', { name: 'TTML → STPP' });
  const lrcSelect = screen.getByRole('combobox', { name: 'LRC → 元数据标签' });
  const button = screen.getByRole('button', { name: '下载嵌入音频' });

  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByText('song.m4a · M4A')).toBeVisible();
  expect(screen.getByText('©lyr')).toBeVisible();
  expect(stppSelect).toHaveValue('add');
  expect(screen.getByRole('option', { name: /覆盖轨道 2/ })).toBeInTheDocument();

  // Selecting none for both disables the primary action with a hint
  fireEvent.change(stppSelect, { target: { value: 'none' } });
  fireEvent.change(lrcSelect, { target: { value: 'none' } });
  expect(button).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('至少选择一项写入内容');

  // Switch back to overwrite track 2 and download
  fireEvent.change(stppSelect, { target: { value: 'overwrite:2' } });
  expect(button).toBeEnabled();
  fireEvent.click(button);

  await waitFor(() => expect(publishingApi.download).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(publishingApi.download).toHaveBeenCalledWith('p1', {
    revision: 'rev-secret-123',
    asset_id: 'asset-1',
    stpp_action: 'overwrite',
    target_track_id: 2,
    lrc_kind: 'none',
    lrc_text: null,
  });
  expect(screen.queryByText(/rev-secret-123/)).toBeNull();
  client.clear();
});

it('disables STPP field for MP3/FLAC and shows tag hint', async () => {
  vi.mocked(publishingApi.info).mockResolvedValue({
    filename: 'song.flac',
    format_label: 'FLAC',
    asset_id: 'asset-2',
    supported: true,
    container: 'flac',
    tracks: [],
    error: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const document = createLyricDocument('歌');

  render(
    <QueryClientProvider client={client}>
      <MusicPackaging projectId="p2" document={document} saveForPackaging={vi.fn()} onIssues={vi.fn()} />
    </QueryClientProvider>,
  );

  const stppSelect = await screen.findByRole('combobox', { name: 'TTML → STPP' });
  expect(stppSelect).toBeDisabled();
  await waitFor(() => expect(screen.getByText('LYRICS')).toBeVisible());
  client.clear();
});
