import {Select} from '../shared/Select';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useQuery} from '@tanstack/react-query';
import {alignmentApi, type AlignmentOptions} from '../adapters/http/alignment';
import {alignmentDefaults, usePreference} from '../adapters/studio-preferences';
import {savePreference} from '../adapters/preferences';
import styles from './alignment.module.css';

export function AlignmentDefaults() {
  const {t}=useTranslation();
  const [raw,setRaw]=usePreference('studio:alignment-defaults', '{}');
  const options={...alignmentDefaults(), ...JSON.parse(raw)} as AlignmentOptions;
  const [gap,setGap]=useState(String(options.gap_threshold_ms)),[error,setError]=useState('');
  const catalog=useQuery({queryKey:['alignment-models'],queryFn:()=>alignmentApi.models()});
  const [model,setModel]=usePreference('studio:alignment-model','');
  const choose=(key:keyof AlignmentOptions,value:boolean|number)=>{const {model_preview:_preview,convert_particles:_particles,...defaults}=options;setRaw(JSON.stringify({...defaults,[key]:value}));};
  const selected=model?JSON.parse(model):null;
  const valid=catalog.data?.items.find(item=>item.name===selected?.name&&item.type===selected?.type&&item.status==='ready');
  const descriptions:Partial<Record<keyof AlignmentOptions,string>>={clear_unmatched:'alignment.clearHelp',smart_extend:'alignment.smartExtendHelp',use_hints:'alignment.startsHelp',line_blank:'alignment.blankHelp',rest_blank:'alignment.restBlankHelp',rest_token:'alignment.restTokenHelp'};
  const groups=[['alignment.preprocessing',[['latin_normalize','alignment.latinNormalize'],['strip_tone_digits','alignment.stripTones']]],['alignment.postprocessing',[['clear_unmatched','alignment.clearUnmatched'],['smart_extend','alignment.smartExtend'],['merge_short_gaps','alignment.mergeGapsLabel']]],['alignment.experimental',[['use_hints','alignment.useStarts'],['line_blank','alignment.blankCost'],['rest_blank','alignment.restBlankCost'],['rest_token','alignment.restTokenCost']]]] as const;
  return <section><h3>{t('settings.alignmentDefaults')}</h3>
    <label>{t('settings.defaultModel')}<Select aria-label={t('settings.defaultModel')} value={valid?.id??''} onChange={e=>{const item=catalog.data?.items.find(item=>item.id===e.target.value);if(item)setModel(JSON.stringify({name:item.name,type:item.type}));else {void savePreference('studio:alignment-model',null).catch(()=>undefined);}}}>
      <option value="">{t('alignment.selectModel')}</option>{catalog.data?.items.filter(item=>item.status==='ready').map(item=><option key={item.name} value={item.id!}>{item.name} · {item.type}</option>)}
    </Select></label>
    {selected&&!valid&&<p role="alert">{t('settings.defaultModelMissing')}</p>}
    {catalog.isError&&<p role="alert">{catalog.error.message}<button data-role="secondary" onClick={()=>void catalog.refetch()}>{t('alignment.retry')}</button></p>}
    {groups.map(([title,items])=><fieldset key={title} className={styles.options}><legend>{t(title)}</legend>{items.map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(options[key])} onChange={e=>choose(key,e.target.checked)}/><span>{t(label)}{descriptions[key]&&<small className={styles.description}>{t(descriptions[key]!)}</small>}</span></label>)}
      {title==='alignment.postprocessing'&&<label>{t('alignment.gapThreshold')}<input type="number" min="1" step="1" value={gap} onChange={e=>setGap(e.target.value)} onBlur={()=>{const value=Number(gap);if(!gap.trim()||!Number.isSafeInteger(value)||value<=0){setError(t('alignment.gapRange'));return;}setError('');choose('gap_threshold_ms',value);}}/> ms</label>}
    </fieldset>)}{error&&<p role="alert">{error}</p>}
  </section>;
}
