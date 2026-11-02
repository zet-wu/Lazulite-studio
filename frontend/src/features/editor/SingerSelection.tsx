import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricAgent, LyricLine } from '../../domain/lyric-document';
import styles from './semantic-editor.module.css';

export function SingerSelection({ agents, lines, apply }: { agents: LyricAgent[]; lines: LyricLine[]; apply: (command: LyricCommand) => boolean }) {
  useTranslation();
  const mixed = lines.some(line => line.agentRefs.join(' ') !== lines[0].agentRefs.join(' '));
  return <fieldset className={styles.singerSelection}><legend>{t('singer.label')}</legend>
    {mixed && <small>{t('common.mixed')}</small>}
    {!lines.some(line => line.agentRefs.length) && <small>{t('common.unspecified')}</small>}
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

const t=i18n.t.bind(i18n);
