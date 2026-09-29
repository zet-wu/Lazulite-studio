import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricAgent, LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

export function SingerSelection({ agents, lines, apply }: { agents: LyricAgent[]; lines: LyricLine[]; apply: (command: LyricCommand) => boolean }) {
  const mixed = lines.some(line => line.agentRefs.join(' ') !== lines[0].agentRefs.join(' '));
  return <fieldset className={styles.singerSelection}><legend>歌手</legend>
    {mixed && <small>混合值</small>}
    {!lines.some(line => line.agentRefs.length) && <small>未指定</small>}
    {agents.map(agent => {
      const count = lines.filter(line => line.agentRefs.includes(agent.id)).length;
      const partial = count > 0 && count < lines.length;
      return <label key={agent.id}><input type="checkbox" aria-label={`歌手 ${agent.name ?? agent.id}`} aria-checked={partial ? 'mixed' : count === lines.length}
        ref={node => { if (node) node.indeterminate = partial; }} checked={count === lines.length}
        onChange={event => {
          const checked = event.target.checked;
          const changed = lines.filter(line => line.agentRefs.includes(agent.id) !== checked);
          if (changed.length) apply({ type: 'batch', commands: changed.map(line => ({ type: 'set-line-agents', lineId: line.id,
            agentRefs: checked ? [...line.agentRefs, agent.id] : line.agentRefs.filter(id => id !== agent.id) })) });
        }} />{agent.name ?? agent.id}</label>;
    })}
  </fieldset>;
}
