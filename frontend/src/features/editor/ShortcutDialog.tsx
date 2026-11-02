import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { bindingError, captureBinding, defaultBindings, formatBinding, saveBindings, shortcutActions, useShortcuts, type ShortcutAction } from '../shortcuts';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function ShortcutDialog({ close }: { close: () => void }) {
  useTranslation();
  const bindings = useShortcuts();
  const [error, setError] = useState<import('../../domain/messages').Message | null>(null);
  return <SettingsDialog title={t('shortcuts.title')} close={close} actions={<button data-role="secondary" onClick={() => { saveBindings(defaultBindings); setError(null); }}>{t('shortcuts.restore')}</button>}>
    <p>{t('shortcuts.help')}</p>
    <div className={styles.syncBindings}>{(Object.keys(shortcutActions) as ShortcutAction[]).map(action => <label key={action}>
      <span>{t(shortcutActions[action][0])} · {t(shortcutActions[action][1])}</span>
      <input aria-label={t('shortcuts.input',{action:t(shortcutActions[action][1])})} readOnly value={formatBinding(bindings[action])} onKeyDown={event => {
        if (event.key === 'Tab' || event.key === 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        if (event.nativeEvent.isComposing || /^(Control|Meta|Alt|Shift)/.test(event.code)) return;
        const binding = captureBinding(event.nativeEvent);
        const reason = bindingError(action, binding, bindings); setError(reason);
        if (!reason) saveBindings({ ...bindings, [action]: binding });
      }} />
      <button data-role="secondary" onClick={() => { const reason = bindingError(action, defaultBindings[action], bindings); setError(reason); if (!reason) saveBindings({ ...bindings, [action]: defaultBindings[action] }); }}>{t('shortcuts.clear')}</button>
    </label>)}</div>{error && <p role="alert">{error.key==='shortcuts.conflict'?t(error.key,{action:t(String(error.values?.actionKey))}):t(error.key)}</p>}
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
