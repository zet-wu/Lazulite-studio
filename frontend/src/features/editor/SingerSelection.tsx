import { useTranslation } from 'react-i18next';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricAgent, LyricLine } from '../../domain/lyric-document';
import { BooleanField } from '../../shared/Controls';
import styles from './semantic-editor.module.css';

export function AgentMembership({ agents, references, label, namedLabel, change }: {
  agents: LyricAgent[]; references: string[][]; label: string; namedLabel: (name: string) => string;
  change: (agentId: string, checked: boolean) => void;
}) {
  const {t} = useTranslation();
  return <fieldset className={styles.singerSelection}><legend>{label}</legend>
    {references.some(refs => refs.join(' ') !== references[0].join(' ')) && <small>{t('common.mixed')}</small>}
    {!references.some(refs => refs.length) && <small>{t('common.unspecified')}</small>}
    {agents.map(agent => {
      const count = references.filter(refs => refs.includes(agent.id)).length;
      return <BooleanField key={agent.id} label={agent.name ?? agent.id} ariaLabel={namedLabel(agent.name ?? agent.id)} checked={count === references.length && count > 0}
        mixed={count > 0 && count < references.length} onChange={checked => change(agent.id, checked)}/>;
    })}
  </fieldset>;
}

export function SingerSelection({ agents, lines, apply }: { agents: LyricAgent[]; lines: LyricLine[]; apply: (command: LyricCommand) => boolean }) {
  const {t} = useTranslation();
  return <AgentMembership agents={agents} references={lines.map(line => line.agentRefs)} label={t('singer.label')} namedLabel={name => t('singer.named',{name})}
    change={(agentId, checked) => {
      const changed = lines.filter(line => line.agentRefs.includes(agentId) !== checked);
      if (changed.length) apply({type:'batch', commands:changed.map(line => ({type:'set-line-agents', lineId:line.id,
        agentRefs:checked ? [...line.agentRefs, agentId] : line.agentRefs.filter(id => id !== agentId)}))});
    }}/>;
}
