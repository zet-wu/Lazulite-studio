import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {chooseLanguage} from '../i18n';
import {languages} from '../i18n/language';
import {message} from '../domain/messages';
export function LanguageSelector() {
 const {t,i18n}=useTranslation();const [error,setError]=useState(false);const sequence=useRef(0);
 return <fieldset><legend>{t('language.label')}</legend>{languages.map(language=><label key={language.id}>
 <input type="radio" name="studio-language" value={language.id} checked={i18n.language===language.id} data-initial-focus={i18n.language===language.id ? '' : undefined} onChange={()=>{const current=++sequence.current;setError(false);void chooseLanguage(language.id).catch(()=>{if(current===sequence.current){setError(true);window.dispatchEvent(new CustomEvent('studio-preference-error',{detail:message('language.saveFailed')}));}});}}/>{language.name}
 </label>)}{error&&<p role="alert">{t('language.saveFailed')}</p>}</fieldset>;
}
