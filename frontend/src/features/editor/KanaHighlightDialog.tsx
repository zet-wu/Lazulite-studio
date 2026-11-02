import { useMessageText } from '../../shared/useMessageText';
import { message } from '../../domain/messages';
import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../shared/Controls';
import { useState } from 'react';
import { SettingsDialog } from './SettingsDialog';
import { defaultKanaHighlight, readKanaHighlight, saveKanaHighlight } from './kana-highlight';

export function KanaHighlightDialog({ close }: { close: () => void }) {
  useTranslation();
  const [value, setValue] = useState(readKanaHighlight);
  const [error, setError] = useMessageText('');
  return <SettingsDialog title={t('kana.title')} close={close} actions={<>
    <button data-role="secondary" onClick={close}>{t('common.cancel')}</button>
    <button data-role="primary" onClick={() => { try { saveKanaHighlight(value); close(); } catch (cause) { setError((cause as Error).message); } }}>{t('menu.save')}</button>
  </>}>
    <label>{t('kana.characters')}<input data-initial-focus aria-label={t('kana.characters')} value={value} onChange={event => { setValue(event.target.value); setError(''); }} /></label>
    <IconButton icon="trash" label={t('kana.clear')} data-role="inline" onClick={() => setValue('')}/>
    <button data-role="inline" onClick={() => setValue(defaultKanaHighlight)}>{t('common.reset')}</button>
    {error && <p role="alert">{error}</p>}
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
