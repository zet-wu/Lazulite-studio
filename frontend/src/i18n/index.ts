import i18next from 'i18next';
import {initReactI18next} from 'react-i18next';
import {browserLanguage,languages,registeredLanguage} from './language';
import {ensureLibraryPreference,writeLibraryPreference} from '../adapters/preferences';
import type {Message} from '../domain/messages';
const resources=import.meta.glob<{default:Record<string,string>}>('./resources/*.json',{eager:true});
export const i18n=i18next.createInstance();
void i18n.use(initReactI18next).init({
 resources:Object.fromEntries(Object.entries(resources).map(([path,value])=>[path.split('/').at(-1)!.replace('.json',''),{translation:value.default}])),
 lng:browserLanguage(navigator.languages),fallbackLng:'zh-Hans',supportedLngs:languages.map(l=>l.id),load:'currentOnly',
 interpolation:{escapeValue:false},react:{useSuspense:false},initAsync:false,
});
const updateDocument=()=>{const locale=languages.find(l=>l.id===i18n.language)??languages[0];document.documentElement.lang=locale.html;document.documentElement.dir=locale.direction;};
i18n.on('languageChanged',updateDocument);updateDocument();
let confirmed=registeredLanguage(i18n.language),request=0;
export async function initializeLanguage() {
 const current=++request;
 const saved=await ensureLibraryPreference('studio:ui-language',browserLanguage(navigator.languages));
 confirmed=registeredLanguage(saved);
 if(current===request)await i18n.changeLanguage(confirmed);
}
export async function chooseLanguage(language:string) {
 const choice=registeredLanguage(language),current=++request;
 await i18n.changeLanguage(choice);
 try {await writeLibraryPreference('studio:ui-language',choice);confirmed=choice;}
 catch(error){if(current===request)await i18n.changeLanguage(confirmed);throw error;}
}
export function formatMessage(value:Message):string { return value.parts ? value.parts.map(formatMessage).join(i18n.t('notice.separator')) : i18n.t(value.key,value.values??{}); }
export const formatDate=(date:string|number|Date)=>new Intl.DateTimeFormat((languages.find(l=>l.id===i18n.language)??languages[0]).format,{dateStyle:'medium',timeStyle:'short'}).format(new Date(date));
