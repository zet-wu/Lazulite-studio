import { useState } from 'react';
import { bindingError, captureBinding, defaultBindings, formatBinding, saveBindings, shortcutActions, useShortcuts, type ShortcutAction } from '../shortcuts';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function ShortcutDialog({ close }: { close: () => void }) {
  const bindings = useShortcuts();
  const [error, setError] = useState('');
  return <SettingsDialog title="快捷键设置" close={close} actions={<button data-role="secondary" onClick={() => { saveBindings(defaultBindings); setError(''); }}>恢复全部默认</button>}>
    <p>点击按键框后录入组合键。打轴按物理键位；播放定位仅在播放器内生效。清除自定义后恢复该项默认。</p>
    <div className={styles.syncBindings}>{(Object.keys(shortcutActions) as ShortcutAction[]).map(action => <label key={action}>
      <span>{shortcutActions[action][0]} · {shortcutActions[action][1]}</span>
      <input aria-label={`${shortcutActions[action][1]}快捷键`} readOnly value={formatBinding(bindings[action])} onKeyDown={event => {
        if (event.key === 'Tab' || event.key === 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        if (event.nativeEvent.isComposing || /^(Control|Meta|Alt|Shift)/.test(event.code)) return;
        const binding = captureBinding(event.nativeEvent);
        const reason = bindingError(action, binding, bindings); setError(reason ?? '');
        if (!reason) saveBindings({ ...bindings, [action]: binding });
      }} />
      <button data-role="secondary" onClick={() => { const reason = bindingError(action, defaultBindings[action], bindings); setError(reason ?? ''); if (!reason) saveBindings({ ...bindings, [action]: defaultBindings[action] }); }}>清除自定义</button>
    </label>)}</div>{error && <p role="alert">{error}</p>}
  </SettingsDialog>;
}
