import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { DraftInput } from './EditorFields';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

export function SingerDialog({ document, apply, close }: { document: LyricDocument; apply: (command: LyricCommand) => boolean; close: () => void }) {
  return <SettingsDialog title="歌手管理" close={close}><div className={styles.singerList}>
    {document.agents.map((agent) => <div key={agent.id}><strong>{agent.id}</strong>
      <DraftInput value={agent.name ?? ''} label={`歌手 ${agent.id}`} onCommit={(name) => apply({ type: 'set-agents', agents: document.agents.map((item) => item.id === agent.id ? { ...item, name: name || null } : item) })} />
      <button onClick={() => apply({ type: 'set-agents', agents: document.agents.filter((item) => item.id !== agent.id) })}>删除歌手</button>
    </div>)}
    <button onClick={() => {
      const id = window.prompt('歌手 ID');
      if (!id) return;
      const name = window.prompt('歌手名称') || null;
      apply({ type: 'set-agents', agents: [...document.agents, { id, name, type: null }] });
    }}>添加歌手</button>
  </div></SettingsDialog>;
}
