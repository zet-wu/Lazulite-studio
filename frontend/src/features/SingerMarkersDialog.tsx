import {useTranslation} from 'react-i18next';
import {useState} from 'react';
import {initializeSingerMarkers,singerKey,usedSingerSets,type SingerMarker} from '../domain/singer-markers';
import type {KaraokeCommand} from '../domain/karaoke';
import type {ProjectDocument} from '../domain/project-document';
import {SettingsDialog} from './editor/SettingsDialog';
import {Select} from '../shared/Select';
import {SettingField,SettingToggle} from '../shared/SettingsFields';
import fields from '../shared/settings-fields.module.css';
import styles from './karaoke.module.css';

export function SingerMarkersDialog({project,close,apply,error}:{project:ProjectDocument;close:()=>void;apply:(command:KaraokeCommand)=>boolean;error:string}) {
  const {t}=useTranslation();
  const sets=usedSingerSets(project.lyrics);
  const [markers,setMarkers]=useState(()=>initializeSingerMarkers(project.lyrics,project.karaoke.singerMarkers));
  const [selected,setSelected]=useState(sets[0]?.key);
  const marker=markers.find(marker=>singerKey(marker.agentIds)===selected);
  const update=(patch:Partial<SingerMarker>)=>setMarkers(markers.map(item=>item===marker?{...item,...patch}:item));
  return <SettingsDialog wide title={t('karaoke.singerMarkers')} close={close} actions={<><button data-dialog-close data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" onClick={()=>{if(apply({kind:'singer-markers',markers}))close();}}>{t('common.apply')}</button></>}>
    {error&&<p role="alert">{error}</p>}
    <div className={styles.markerEditor}>
      <nav className={`${styles.markerList} ${fields.navigation}`} aria-label={t('markers.sets')}>{sets.map(set=><button key={set.key} data-role="secondary" aria-current={set.key===selected?'page':undefined} onClick={()=>setSelected(set.key)}>{set.label}</button>)}</nav>
      {marker?<div className={styles.markerFields}>
        <h3>{sets.find(set=>set.key===selected)?.label}</h3>
        <SettingToggle label={t('markers.skip')} checked={marker.skip} onChange={value=>update({skip:value})}/>
        <fieldset disabled={marker.skip} className={fields.group}>
          <fieldset className={fields.group}><legend>{t('markers.images')}</legend>
            {([['trigger',t('markers.trigger')],['beforeImage',t('markers.before')],['afterImage',t('markers.after')]] as const).map(([key,label])=><SettingField key={key} label={label} stacked={key!=='trigger'}><input value={marker[key]} onChange={event=>update({[key]:event.target.value})}/></SettingField>)}
          </fieldset>
          <fieldset className={fields.group}><legend>{t('markers.dimensions')}</legend>
            <SettingField label={t('markers.sizeMode')}><Select value={marker.sizeMode} onChange={event=>update({sizeMode:event.target.value as SingerMarker['sizeMode']})}><option value="Zoom">Zoom</option><option value="Fix">Fix</option></Select></SettingField>
            {marker.sizeMode==='Zoom'&&<SettingField label={t('markers.zoom')}><input value={marker.zoom} onChange={event=>update({zoom:event.target.value})}/></SettingField>}
          </fieldset>
          <fieldset className={fields.group}><legend>{t('markers.decoration')}</legend>
            <SettingToggle label="NoDecor" checked={marker.noDecor} onChange={value=>update({noDecor:value})}/>
            <SettingToggle label="ForceWipeDecor" disabled={marker.noDecor} checked={marker.forceWipeDecor&&!marker.noDecor} onChange={value=>update({forceWipeDecor:value})}/>
          </fieldset>
          <fieldset className={fields.group}><legend>{t('markers.margins')}</legend>
            {([['marginLeft',t('markers.left')],['marginRight',t('markers.right')],['marginBottom',t('markers.bottom')]] as const).map(([key,label])=><SettingField key={key} label={label}><input type="number" step={1} value={Number.isNaN(marker[key])?'':marker[key]} onChange={event=>update({[key]:event.target.value===''?NaN:Number(event.target.value)})}/></SettingField>)}
          </fieldset>
        </fieldset>
      </div>:<p>{t('markers.noSingers')}</p>}
    </div>
  </SettingsDialog>;
}
