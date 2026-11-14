import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {chooseLanguage} from '../i18n';
import {languages} from '../i18n/language';
import {Select} from '../shared/Select';
import {SettingField} from '../shared/SettingsFields';
export function LanguageSelector() {
 const {t,i18n}=useTranslation();const [error,setError]=useState(false);const sequence=useRef(0);
 return <SettingField label={t('language.label')} error={error?t('language.saveFailed'):undefined}>
 <Select aria-label={t('language.label')} data-initial-focus value={i18n.language} onChange={event=>{const current=++sequence.current;setError(false);void chooseLanguage(event.target.value).catch(()=>{if(current===sequence.current)setError(true);});}}>
 {languages.map(language=><option key={language.id} value={language.id}>{language.name}</option>)}
 </Select></SettingField>;
}
