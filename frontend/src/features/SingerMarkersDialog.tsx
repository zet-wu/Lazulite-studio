import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { initializeSingerMarkers, singerKey, usedSingerSets, type SingerMarker } from '../domain/singer-markers';
import type { KaraokeCommand } from '../domain/karaoke';
import type { ProjectDocument } from '../domain/project-document';
import { SettingsDialog } from './editor/SettingsDialog';
import { Select } from '../shared/Select';
import styles from './karaoke.module.css';

export function SingerMarkersDialog({project,close,apply,error}:{project:ProjectDocument;close:()=>void;apply:(command:KaraokeCommand)=>boolean;error:string}) {
  useTranslation();
  const sets=usedSingerSets(project.lyrics);
  const [markers,setMarkers]=useState(()=>initializeSingerMarkers(project.lyrics,project.karaoke.singerMarkers));
  const [selected,setSelected]=useState(sets[0]?.key);
  const marker=markers.find(marker=>singerKey(marker.agentIds)===selected);
  const update=(patch:Partial<SingerMarker>)=>setMarkers(markers.map(item=>item===marker?{...item,...patch}:item));
  return <SettingsDialog title={t('karaoke.singerMarkers')} close={close}>
    {error&&<p role="alert">{error}</p>}
    <div className={styles.markerEditor}>
      <div className={styles.markerList} aria-label={t('markers.sets')}>{sets.map(set=><button key={set.key} data-role="secondary" aria-pressed={set.key===selected} onClick={()=>setSelected(set.key)}>{set.label}</button>)}</div>
      {marker?<div className={styles.markerFields}>
        <strong>{sets.find(set=>set.key===selected)?.label}</strong>
        <label><input type="checkbox" checked={marker.skip} onChange={event=>update({skip:event.target.checked})}/>{t('markers.skip')}</label>
        <fieldset disabled={marker.skip} className={styles.markerFields}>
        {([['trigger',t('markers.trigger')],['beforeImage',t('markers.before')],['afterImage',t('markers.after')]] as const).map(([key,label])=><label key={key}>{label}<input value={marker[key]} onChange={event=>update({[key]:event.target.value})}/></label>)}
        <label>{t('markers.sizeMode')}<Select value={marker.sizeMode} onChange={event=>update({sizeMode:event.target.value as SingerMarker['sizeMode']})}><option value="Zoom">Zoom</option><option value="Fix">Fix</option></Select></label>
        {marker.sizeMode==='Zoom'&&<label>{t('markers.zoom')}<input value={marker.zoom} onChange={event=>update({zoom:event.target.value})}/></label>}
        <label><input type="checkbox" checked={marker.noDecor} onChange={event=>update({noDecor:event.target.checked})}/>NoDecor</label>
        <label><input type="checkbox" disabled={marker.noDecor} checked={marker.forceWipeDecor&&!marker.noDecor} onChange={event=>update({forceWipeDecor:event.target.checked})}/>ForceWipeDecor</label>
        {([['marginLeft',t('markers.left')],['marginRight',t('markers.right')],['marginBottom',t('markers.bottom')]] as const).map(([key,label])=><label key={key}>{label}<input type="number" step={1} value={Number.isNaN(marker[key])?'':marker[key]} onChange={event=>update({[key]:event.target.value===''?NaN:Number(event.target.value)})}/></label>)}
        </fieldset>
      </div>:<p>{t('markers.noSingers')}</p>}
    </div>
    <button data-role="primary" onClick={()=>{if(apply({kind:'singer-markers',markers}))close();}}>{t('common.apply')}</button>
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
