import {IconButton} from '../../shared/Controls';
import {Select} from '../../shared/Select';
import {useEffect, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {SettingsDialog} from './SettingsDialog';
import {LanguageSelector} from '../LanguageSelector';
import {AlignmentModelsDialog} from '../AlignmentModelsDialog';
import {AlignmentDefaults} from '../AlignmentDefaults';
import {DeviceSettings} from '../DeviceSettings';
import {DictionaryManager} from './DictionaryManager';
import {ShortcutDialog} from './ShortcutDialog';
import {usePreference} from '../../adapters/studio-preferences';
import {normalizeKanaHighlight, defaultKanaHighlight} from './kana-highlight';
import {readColumnPreferences, COLUMN_STORAGE, COLUMN_DEFAULTS} from './column-preferences';
import {formatMessage} from '../../i18n';
import {errorMessage} from '../../domain/messages';
import styles from './studio-settings.module.css';

export function StudioSettings({close, amll, locked=false, initial='appearance'}:{close:()=>void; amll?:ReactNode; locked?:boolean; initial?:string}) {
  const {t}=useTranslation();
  const [saveError,setSaveError]=useState('');
  useEffect(()=>{const failed=(event:Event)=>setSaveError(formatMessage((event as CustomEvent).detail));window.addEventListener('studio-preference-error',failed);return()=>window.removeEventListener('studio-preference-error',failed);},[]);
  const [page,setPage]=useState(initial);
  const [theme,setTheme]=usePreference('lazulite-editor-theme','light');
  const [columns,setColumns]=usePreference(COLUMN_STORAGE,JSON.stringify(COLUMN_DEFAULTS));
  const columnValues={...readColumnPreferences(),...JSON.parse(columns)};
  const [particles,setParticles]=usePreference('studio:convert-particles',true);
  const [highlight,setHighlight]=usePreference('studio:kana-highlight',defaultKanaHighlight);
  const [draft,setDraft]=useState(highlight),[error,setError]=useState('');
  const [translation,setTranslation]=usePreference('studio:preview-translation',true);
  const [romanization,setRomanization]=usePreference('studio:preview-romanization',true);
  const [hide,setHide]=usePreference('studio:preview-hide',false);
  const [fade,setFade]=usePreference('studio:preview-fade',0.5);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  const categories=[['appearance','settings.appearance'],['reading','settings.reading'],['models','settings.modelsCompute'],['shortcuts','menu.shortcuts'],['preview','preview.title']] as const;
  const title=page==='amll'?t('menu.amll'):t(categories.find(([key])=>key===page)![1]);
  return <SettingsDialog wide title={t('menu.settings')} close={close}><div className={styles.layout}>
    <nav aria-label={t('menu.settings')} className={styles.navigation}><strong>{t('settings.studio')}</strong>
      {categories.map(([key,label])=><button key={key} data-role="secondary" aria-current={page===key?'page':undefined} onClick={()=>setPage(key)}>{t(label)}</button>)}
      <strong className={styles.project}>{t('settings.project')}</strong>
      <button data-role="secondary" disabled={!amll} aria-current={page==='amll'?'page':undefined} onClick={()=>setPage('amll')}>{t('menu.amll')}</button>{!amll&&<small>{t('settings.openProject')}</small>}
    </nav>
    <div className={styles.content}>{saveError&&<p role="alert">{saveError}</p>}<h2>{title}</h2>
      {page==='appearance'&&<><LanguageSelector/><label>{t('settings.theme')}<Select aria-label={t('settings.theme')} value={theme} onChange={e=>setTheme(e.target.value)}><option value="light">{t('menu.light')}</option><option value="dark">{t('menu.dark')}</option></Select></label>
        {(['outlineVisible','inspectorVisible'] as const).map(key=><label key={key}><input type="checkbox" checked={columnValues[key]} onChange={e=>setColumns(JSON.stringify({...columnValues,[key]:e.target.checked}))}/>{t(key==='outlineVisible'?'menu.outline':'menu.inspector')}</label>)}
        <div><IconButton icon="refresh" data-role="secondary" label={t('settings.resetWidths')} onClick={()=>setColumns(JSON.stringify({...columnValues,outlineWidth:COLUMN_DEFAULTS.outlineWidth,inspectorWidth:COLUMN_DEFAULTS.inspectorWidth}))}/></div></>}
      {page==='reading'&&<><DictionaryManager embedded close={close}/><h3>{t('settings.latinization')}</h3><label className={styles.option}><input type="checkbox" checked={particles} onChange={e=>setParticles(e.target.checked)}/><span>{t('settings.convertParticles')}<small>{t('settings.particleHelp')}</small></span></label>
        <label>{t('settings.defaultHighlight')}<input value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{try{const value=normalizeKanaHighlight(draft);setHighlight(value);setDraft(value);setError('');}catch(cause){setError(formatMessage(errorMessage(cause)));}}}/></label>{error&&<p role="alert">{error}</p>}</>}
      {page==='models'&&<><AlignmentModelsDialog embedded close={close}/><AlignmentDefaults/><h3>{t('menu.devices')}</h3><DeviceSettings embedded/></>}
      {page==='shortcuts'&&<ShortcutDialog embedded close={close}/>}
      {page==='preview'&&<>{[[translation,setTranslation,'capability.translation'],[romanization,setRomanization,'capability.romanization'],[hide,setHide,'preview.hidePlayed']].map(([value,set,label])=><label key={String(label)}><input type="checkbox" checked={Boolean(value)} onChange={e=>(set as (value:boolean)=>void)(e.target.checked)}/>{t(String(label))}</label>)}<label>{t('preview.gradient')}<input type="range" min="0.05" max="1.5" step="0.05" value={fade} onChange={e=>setFade(Number(e.target.value))}/></label></>}
      {page==='amll'&&<fieldset disabled={locked}>{amll}</fieldset>}
    </div>
  </div></SettingsDialog>;
}
