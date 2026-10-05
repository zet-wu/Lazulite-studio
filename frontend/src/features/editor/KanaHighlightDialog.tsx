import { useState } from 'react';
import { SettingsDialog } from './SettingsDialog';
import { defaultKanaHighlight, readKanaHighlight, saveKanaHighlight } from './kana-highlight';

export function KanaHighlightDialog({ close }: { close: () => void }) {
  const [value, setValue] = useState(readKanaHighlight);
  const [error, setError] = useState('');
  return <SettingsDialog title="音译生成假名高亮" close={close} actions={<>
    <button data-role="secondary" onClick={close}>取消</button>
    <button data-role="primary" onClick={() => { try { saveKanaHighlight(value); close(); } catch (cause) { setError((cause as Error).message); } }}>保存</button>
  </>}>
    <label>假名集合 <input data-initial-focus aria-label="假名集合" value={value} onChange={event => { setValue(event.target.value); setError(''); }} /></label>
    <button data-role="inline" onClick={() => setValue('')}>清空</button>
    <button data-role="inline" onClick={() => setValue(defaultKanaHighlight)}>恢复默认</button>
    {error && <p role="alert">{error}</p>}
  </SettingsDialog>;
}
