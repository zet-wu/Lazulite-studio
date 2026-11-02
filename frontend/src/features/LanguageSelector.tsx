import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {chooseLanguage} from '../i18n';
import {languages} from '../i18n/language';
import {Select} from '../shared/Select';
export function LanguageSelector() {
 const {t,i18n}=useTranslation();const [error,setError]=useState(false);const sequence=useRef(0);
 return <label>{t('language.label')} <Select aria-label={t('language.label')} value={i18n.language} onChange={event=>{const current=++sequence.current;setError(false);void chooseLanguage(event.target.value).catch(()=>{if(current===sequence.current)setError(true);});}}>
   {languages.map(language=><option key={language.id} value={language.id}>{language.name}</option>)}
 </Select>{error&&<span role="alert">{t('language.saveFailed')}</span>}</label>;
}
