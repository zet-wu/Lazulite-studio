import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KaraokeCommand } from '../domain/karaoke';
import { singerKey } from '../domain/singer-markers';
import type { ProjectDocument } from '../domain/project-document';
import { sugSingerName, sugSingerOptions } from '../adapters/sug-singers';
import { karaokeOutputLabel } from './output-messages';
import { SettingsDialog } from './editor/SettingsDialog';
import { IconButton } from '../shared/Controls';
import fields from '../shared/settings-fields.module.css';
import styles from './karaoke.module.css';

export function SugSingersDialog({project, close, apply, error}: {project:ProjectDocument; close:()=>void; apply:(command:KaraokeCommand)=>boolean; error:string}) {
  const {t} = useTranslation();
  const options = sugSingerOptions(project);
  const sets = [...new Map(options.flatMap(item => item.sets.map(set => [set.key, set] as const))).values()];
  const [selected, setSelected] = useState(sets[0]?.key);
  const [names, setNames] = useState(project.karaoke.sugSingerNames ?? []);
  const set = sets.find(item => item.key === selected);
  const label = (item:typeof sets[number]) => item.ids.length ? item.label : t('sugSingers.unspecified');
  const update = (outputId:string, name:string) => setNames(previous => [
    ...previous.filter(item => item.outputId !== outputId || singerKey(item.agentIds) !== selected),
    ...(name.length && set ? [{outputId, agentIds:set.ids, name}] : []),
  ]);
  const draft = {...project, karaoke:{...project.karaoke, sugSingerNames:names}};
  return <SettingsDialog wide title={t('karaoke.sugSingers')} close={close} actions={<>
    <button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button>
    <button data-role="primary" onClick={()=>{if(apply({kind:'sug-singer-names',names}))close();}}>{t('common.apply')}</button>
  </>}>
    <p id="sug-singers-help">{t('sugSingers.mergeHelp')}</p>
    {error && <p role="alert">{error}</p>}
    {set ? <div className={styles.markerEditor}>
      <nav className={`${styles.markerList} ${fields.navigation}`} aria-label={t('markers.sets')}>
        {sets.map(item => <button key={item.key} data-role="secondary" title={label(item)} aria-current={item.key === selected ? 'page' : undefined} onClick={()=>setSelected(item.key)}>{label(item)}</button>)}
      </nav>
      <div className={`${styles.markerFields} ${styles.sugFields}`}>
        <h3 className={styles.sugHeading}>{label(set)}</h3>
        {options.filter(item => item.sets.some(singer => singer.key === selected)).map(({output}) => {
          const name = sugSingerName(draft, output, set), custom = names.some(item => item.outputId === output.id && singerKey(item.agentIds) === selected);
          return <div className={styles.sugNameRow} key={output.id}>
            <label><span>{karaokeOutputLabel(output,project)}</span><span className={fields.control}><input name={output.id} autoComplete="off" aria-describedby="sug-singers-help" value={name} title={name} onChange={event=>update(output.id,event.target.value)}/></span></label>
            <IconButton icon="undo" label={t('sugSingers.reset',{output:karaokeOutputLabel(output,project)})} disabled={!custom} onClick={event=>{update(output.id,'');event.currentTarget.parentElement?.querySelector('input')?.focus();}}/>
          </div>;
        })}
      </div>
    </div> : <p>{t('sugSingers.empty')}</p>}
  </SettingsDialog>;
}
