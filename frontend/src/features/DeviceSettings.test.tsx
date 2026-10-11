import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceSettings } from './DeviceSettings';
const mock = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn() }));
vi.mock('../adapters/http/client', () => ({ studioApi: { getSession: mock.session }, requestHeaders: () => ({}) }));
vi.mock('../adapters/preferences', () => ({ preferences: { getItem: () => 'auto' }, savePreference: mock.save }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function show(target: string, mode = 'local') {
  mock.session.mockResolvedValue({ mode });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ target }) }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeviceSettings /></QueryClientProvider>);
}
it('shows CPU-only controls and remote service configuration', async () => {
  show('windows-x64-cpu');
  expect(await screen.findByLabelText('人声分离计算设备')).toBeDisabled();
  expect(screen.getAllByRole('option').map(x => x.textContent)).toEqual(['CPU', 'CPU']);
  cleanup(); show('', 'remote');
  expect(await screen.findByText('计算设备由服务配置。')).toBeVisible();
  expect(screen.queryByRole('combobox')).toBeNull();
});
it.each(['windows-x64-cuda', 'macos-arm64'])('saves independent preferences and retains the value after failure: %s', async target => {
  show(target);
  const vocal = await screen.findByLabelText('人声分离计算设备');
  mock.save.mockRejectedValueOnce(new Error('偏好发生冲突'));
  fireEvent.change(vocal, { target: { value: 'cpu' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('偏好发生冲突');
  expect(vocal).toHaveValue('auto');
  mock.save.mockResolvedValueOnce(undefined);
  fireEvent.change(vocal, { target: { value: 'cpu' } });
  await waitFor(() => expect(vocal).toHaveValue('cpu'));
  expect(mock.save).toHaveBeenLastCalledWith('device.vocal', 'cpu');
  expect(screen.getByLabelText('自动对齐计算设备')).toHaveValue('auto');
});
