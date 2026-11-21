import {changeEditorDisplay, type EditorDisplay} from '../../adapters/editor-display';
import {VocalModels} from '../VocalModels';
import {useTimelineAutoExpand, useSpectrumHeight, type AutoExpandMode, useTimelineSwapWheel, useTimelineVisibility, useStagingIgnoredCharacters, timelineLayers, type TimelineLayer} from '../../adapters/timeline-preferences';
import {SettingField, SettingToggle} from '../../shared/SettingsFields';
import fields from '../../shared/settings-fields.module.css';
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
  const [autoExpand,setAutoExpand]=useTimelineAutoExpand();
  const [spectrumHeight,setSpectrumHeight]=useSpectrumHeight();
  const [heightDraft,setHeightDraft]=useState(String(spectrumHeight));
  const [heightError,setHeightError]=useState('');
  useEffect(()=>{setHeightDraft(String(spectrumHeight));setHeightError('');},[spectrumHeight]);
  const commitHeight=()=>{
    const value=Number(heightDraft);
    if(!heightDraft.trim()||!Number.isInteger(value)||value<36||value>216){setHeightError(t('settings.spectrumHeightInvalid'));return;}
    setSpectrumHeight(value);setHeightDraft(String(value));setHeightError('');
  };
  const [swapWheel,setSwapWheel]=useTimelineSwapWheel();
  const [layers,setLayer]=useTimelineVisibility();
  const [ignored,setIgnored]=useStagingIgnoredCharacters();
  const [ignoredDraft,setIgnoredDraft]=useState(ignored);
  useEffect(()=>setIgnoredDraft(ignored),[ignored]);
  const [page,setPage]=useState(initial);
  const [display]=usePreference('studio:editor-display','advanced');
  const [theme,setTheme]=usePreference('lazulite-editor-theme','light');
  const [columns,setColumns]=usePreference(COLUMN_STORAGE,JSON.stringify(COLUMN_DEFAULTS));
  const columnValues={...readColumnPreferences(),...JSON.parse(columns)};
  const [skipAlignment,setSkipAlignment]=usePreference('studio:background-skip-alignment',true);
  const [skipSync,setSkipSync]=usePreference('studio:background-skip-sync',true);
  const [particles,setParticles]=usePreference('studio:convert-particles',true);
  const [highlight,setHighlight]=usePreference('studio:kana-highlight',defaultKanaHighlight);
  const [draft,setDraft]=useState(highlight),[error,setError]=useState('');
  const [translation,setTranslation]=usePreference('studio:preview-translation',true);
  const [romanization,setRomanization]=usePreference('studio:preview-romanization',true);
  const [hide,setHide]=usePreference('studio:preview-hide',false);
  const [fade,setFade]=usePreference('studio:preview-fade',0.5);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  const categories=[['appearance','settings.appearance'],['editing','settings.editing'],['reading','settings.reading'],['models','settings.modelsCompute'],['timeline','settings.timeline'],['shortcuts','menu.shortcuts'],['preview','preview.title']] as const;
  const title=page==='amll'?t('menu.amll'):t(categories.find(([key])=>key===page)![1]);
  return <SettingsDialog wide title={t('menu.settings')} close={close}><div className={styles.layout}>
    <nav aria-label={t('menu.settings')} className={`${styles.navigation} ${fields.navigation}`}><strong>{t('settings.studio')}</strong>
      {categories.map(([key,label])=><button key={key} data-role="secondary" aria-current={page===key?'page':undefined} onClick={()=>setPage(key)}>{t(label)}</button>)}
      <strong className={styles.project}>{t('settings.project')}</strong>
      <button data-role="secondary" disabled={!amll} aria-current={page==='amll'?'page':undefined} onClick={()=>setPage('amll')}>{t('menu.amll')}</button>{!amll&&<small>{t('settings.openProject')}</small>}
    </nav>
    <div className={styles.content}>{saveError&&<p role="alert" className={fields.error}>{saveError}</p>}<h2>{title}</h2>
      {page==='appearance'&&<><LanguageSelector/><SettingField label={t('settings.theme')}><Select aria-label={t('settings.theme')} value={theme} onChange={e=>setTheme(e.target.value)}><option value="light">{t('menu.light')}</option><option value="dark">{t('menu.dark')}</option></Select></SettingField>
        <SettingField label={t('settings.editorDisplay')}><Select aria-label={t('settings.editorDisplay')} value={display} onChange={e=>changeEditorDisplay(e.target.value as EditorDisplay)}><option value="simple">{t('settings.simpleMode')}</option><option value="advanced">{t('settings.advancedMode')}</option></Select></SettingField>
        {(['outlineVisible','inspectorVisible'] as const).map(key=><SettingToggle key={key} label={t(key==='outlineVisible'?'menu.outline':'menu.inspector')} checked={columnValues[key]} onChange={value=>setColumns(JSON.stringify({...columnValues,[key]:value}))}/>)}
        <SettingField label={t('settings.resetWidths')}><IconButton icon="refresh" data-role="secondary" label={t('settings.resetWidths')} onClick={()=>setColumns(JSON.stringify({...columnValues,outlineWidth:COLUMN_DEFAULTS.outlineWidth,inspectorWidth:COLUMN_DEFAULTS.inspectorWidth}))}/></SettingField></>}
      {page==='editing'&&<><SettingToggle label={t('settings.backgroundSkipAlignment')} checked={skipAlignment} onChange={setSkipAlignment}/><SettingToggle label={t('settings.backgroundSkipSync')} checked={skipSync} onChange={setSkipSync}/></>}
      {page==='reading'&&<><DictionaryManager embedded close={close}/><h3>{t('settings.latinization')}</h3><SettingToggle label={t('settings.convertParticles')} description={t('settings.particleHelp')} checked={particles} onChange={setParticles}/>
        <SettingField label={t('settings.defaultHighlight')} error={error}><input value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{try{const value=normalizeKanaHighlight(draft);setHighlight(value);setDraft(value);setError('');}catch(cause){setError(formatMessage(errorMessage(cause)));}}}/></SettingField></>}
      {page==='models'&&<><VocalModels/><AlignmentModelsDialog embedded close={close}/><AlignmentDefaults/><h3>{t('menu.devices')}</h3><DeviceSettings embedded/></>}
      {page==='timeline'&&<><SettingField label={t('settings.autoExpand')}><Select aria-label={t('settings.autoExpand')} value={autoExpand} onChange={e=>setAutoExpand(e.target.value as AutoExpandMode)}>{(['always','follow','off'] as const).map(mode=><option key={mode} value={mode}>{t(`settings.autoExpand.${mode}`)}</option>)}</Select></SettingField><SettingToggle label={t('settings.swapWheel')} description={t('settings.swapWheelHelp')} checked={swapWheel} onChange={setSwapWheel}/><SettingField label={t('settings.stagingIgnored')}><input aria-label={t('settings.stagingIgnored')} name="staging-ignored-characters" autoComplete="off" spellCheck={false} value={ignoredDraft} onChange={e=>setIgnoredDraft(e.target.value)} onBlur={()=>setIgnored(ignoredDraft)} onKeyDown={e=>{if(e.key==='Enter'){setIgnored(ignoredDraft);e.currentTarget.blur();}if(e.key==='Escape'&&ignoredDraft!==ignored){setIgnoredDraft(ignored);e.stopPropagation();}}}/></SettingField><SettingField label={t('settings.spectrumHeight')} description={t('settings.spectrumHeightRange')} error={heightError} errorId="spectrum-height-error"><input type="number" min={36} max={216} step={1} name="spectrum-height" autoComplete="off" aria-label={t('settings.spectrumHeight')} aria-invalid={!!heightError} aria-describedby={heightError?'spectrum-height-error':undefined} value={heightDraft} onChange={e=>{setHeightDraft(e.target.value);setHeightError('');}} onBlur={commitHeight} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitHeight();}if(e.key==='Escape'){e.stopPropagation();setHeightDraft(String(spectrumHeight));setHeightError('');}}}/><span>px</span></SettingField><h3>{t('media.layers')}</h3>{(Object.keys(timelineLayers) as TimelineLayer[]).map(key=><SettingToggle key={key} label={t(timelineLayers[key])} checked={layers[key]} onChange={value=>setLayer(key,value)}/>)}</>}
      {page==='shortcuts'&&<ShortcutDialog embedded close={close}/>}
      {page==='preview'&&<>{[[translation,setTranslation,'capability.translation'],[romanization,setRomanization,'capability.romanization'],[hide,setHide,'preview.hidePlayed']].map(([value,set,label])=><SettingToggle key={String(label)} label={t(String(label))} checked={Boolean(value)} onChange={set as (value:boolean)=>void}/>)}<SettingField label={t('preview.gradient')}><input type="range" min="0.05" max="1.5" step="0.05" value={fade} onChange={e=>setFade(Number(e.target.value))}/></SettingField></>}
      {page==='amll'&&<fieldset className={fields.group} disabled={locked}>{amll}</fieldset>}
    </div>
  </div></SettingsDialog>;
}
