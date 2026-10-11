import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studioApi, requestHeaders } from '../adapters/http/client';
import { preferences, savePreference } from '../adapters/preferences';

export function DeviceSettings() {
  const session = useQuery({ queryKey: ['session'], queryFn: studioApi.getSession });
  const runtime = useQuery({ queryKey: ['runtime'], enabled: session.data?.mode === 'local', queryFn: async () => {
    const response = await fetch('/api/v1/runtime', { headers: requestHeaders() });
    if (!response.ok) throw new Error('无法读取运行方式');
    return await response.json() as { target?: string };
  } });
  const [values, setValues] = useState(() => ({ vocal: preferences.getItem('device.vocal') ?? 'auto', alignment: preferences.getItem('device.alignment') ?? 'auto' }));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  if (session.isError || runtime.isError) return <p role="alert">无法读取计算设备设置。<button data-role="secondary" onClick={() => { void session.refetch(); void runtime.refetch(); }}>重试读取</button></p>;
  if (!session.data || (session.data.mode === 'local' && !runtime.data)) return <p role="status">正在读取计算设备设置…</p>;
  if (session.data.mode !== 'local') return <p>计算设备由服务配置。</p>;
  const cpuOnly = runtime.data?.target === 'windows-x64-cpu';
  return <div style={{ display: 'grid', gap: 12 }}>
    {(['vocal', 'alignment'] as const).map(stage => <label key={stage} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span>{stage === 'vocal' ? '人声分离' : '自动对齐'}</span>
      <select aria-label={stage === 'vocal' ? '人声分离计算设备' : '自动对齐计算设备'} disabled={saving || cpuOnly} value={cpuOnly ? 'auto' : values[stage]} onChange={async event => {
        const value = event.target.value; setSaving(true); setError('');
        try { await savePreference(`device.${stage}`, value); setValues(old => ({ ...old, [stage]: value })); }
        catch (cause) { setError((cause as Error).message); }
        finally { setSaving(false); }
      }}><option value="auto">{cpuOnly ? 'CPU' : '自动'}</option>{!cpuOnly && <option value="cpu">CPU</option>}</select>
    </label>)}
    <p>修改仅影响后续任务；自动按服务配置选择设备。</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
