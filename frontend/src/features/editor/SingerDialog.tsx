import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { DraftInput } from './EditorFields';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function SingerDialog({ document, apply, close }: { document: LyricDocument; apply: (command: LyricCommand) => boolean; close: () => void }) {
  const [adding, setAdding] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const cancel = () => { setAdding(false); setId(''); setName(''); setError(''); };
  return <SettingsDialog title="歌手管理" close={close}><div className={styles.singerList}>
    {document.agents.map((agent) => <div key={agent.id}><strong>{agent.id}</strong>
      <DraftInput value={agent.name ?? ''} label={`歌手 ${agent.id}`} onCommit={(name) => apply({ type: 'set-agents', agents: document.agents.map((item) => item.id === agent.id ? { ...item, name: name || null } : item) })} />
      <button onClick={() => apply({ type: 'set-agents', agents: document.agents.filter((item) => item.id !== agent.id) })}>删除歌手</button>
    </div>)}
    {adding ? <form onSubmit={event => {
      event.preventDefault();
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id)) { setError('歌手 ID 须以字母或下划线开头，后续可含数字、点和连字符'); return; }
      if (document.agents.some(agent => agent.id === id)) { setError('歌手 ID 已存在'); return; }
      if (apply({ type: 'set-agents', agents: [...document.agents, { id, name: name || null, type: null }] })) cancel();
      else setError('添加失败，请检查歌手信息');
    }}><label>歌手 ID<input autoFocus value={id} onChange={event => setId(event.target.value)} /></label><label>歌手名称<input value={name} onChange={event => setName(event.target.value)} /></label><button type="submit">添加</button><button type="button" onClick={cancel}>取消新增</button>{error && <p role="alert">{error}</p>}</form>
      : <button onClick={() => setAdding(true)}>添加歌手</button>}
  </div></SettingsDialog>;
}
