import { useMessageText } from '../shared/useMessageText';
import { message } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../shared/Controls';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studioApi, requestHeaders } from '../adapters/http/client';
import { preferences, savePreference } from '../adapters/preferences';

export function DeviceSettings() {
  useTranslation();
  const session = useQuery({ queryKey: ['session'], queryFn: studioApi.getSession });
  const runtime = useQuery({ queryKey: ['runtime'], enabled: session.data?.mode === 'local', queryFn: async () => {
    const response = await fetch('/api/v1/runtime', { headers: requestHeaders() });
    if (!response.ok) throw new Error(t('settings.modeFailed'));
    return await response.json() as { target?: string };
  } });
  const [values, setValues] = useState(() => ({ vocal: preferences.getItem('device.vocal') ?? 'auto', alignment: preferences.getItem('device.alignment') ?? 'auto' }));
  const [error, setError] = useMessageText(''), [saving, setSaving] = useState(false);
  if (session.isError || runtime.isError) return <p role="alert">{t('settings.devicesFailed')}<IconButton icon="refresh" label={t('settings.retryDevices')} data-role="secondary" onClick={() => { void session.refetch(); void runtime.refetch(); }}/></p>;
  if (!session.data || (session.data.mode === 'local' && !runtime.data)) return <p role="status">{t('settings.loadingDevices')}</p>;
  if (session.data.mode !== 'local') return <p>{t('settings.serviceDevices')}</p>;
  const cpuOnly = runtime.data?.target === 'windows-x64-cpu';
  return <div style={{ display: 'grid', gap: 12 }}>
    {(['vocal', 'alignment'] as const).map(stage => <label key={stage} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span>{stage === 'vocal' ? t('settings.vocalSeparation') : t('settings.alignment')}</span>
      <select aria-label={stage === 'vocal' ? t('settings.vocalDevice') : t('settings.alignmentDevice')} disabled={saving || cpuOnly} value={cpuOnly ? 'auto' : values[stage]} onChange={async event => {
        const value = event.target.value; setSaving(true); setError('');
        try { await savePreference(`device.${stage}`, value); setValues(old => ({ ...old, [stage]: value })); }
        catch (cause) { setError((cause as Error).message); }
        finally { setSaving(false); }
      }}><option value="auto">{cpuOnly ? 'CPU' : t('settings.auto')}</option>{!cpuOnly && <option value="cpu">CPU</option>}</select>
    </label>)}
    <p>{t('settings.deviceHelp')}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

const t=i18n.t.bind(i18n);
