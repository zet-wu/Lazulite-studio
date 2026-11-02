import registry from '../../../server/ui_languages.json';
export const languages=registry.filter(language=>language.complete);
export type Language = string;
export function registeredLanguage(value: string | null | undefined): string {
  return languages.some(language=>language.id===value)?value!:'zh-Hans';
}
export function browserLanguage(preferred: readonly string[]): string {
  for(const raw of preferred) {
    let locale: Intl.Locale;
    try {locale=new Intl.Locale(raw);} catch {continue;}
    if(locale.language==='en')return 'en';
    if(locale.language!=='zh')continue;
    if(locale.script)return locale.script==='Hant'?'zh-Hant':'zh-Hans';
    return ['TW','HK','MO'].includes(locale.region??'')?'zh-Hant':'zh-Hans';
  }
  return 'zh-Hans';
}
