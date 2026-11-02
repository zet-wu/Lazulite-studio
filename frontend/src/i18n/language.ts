import registry from '../../../server/ui_languages.json';
export const languages=registry.filter(language=>language.complete);
export type Language = string;
export function registeredLanguage(value: string | null | undefined): string {
  return languages.some(language=>language.id===value)?value!:'zh-Hans';
}
export function browserLanguage(preferred: readonly string[], available = languages): string {
  for(const raw of preferred) {
    let locale: Intl.Locale;
    try {locale=new Intl.Locale(raw);} catch {continue;}
    if(locale.language==='zh') {
      const script=locale.script;
      if(script && script!=='Hans' && script!=='Hant')continue;
      const id=script ? `zh-${script}` : ['TW','HK','MO'].includes(locale.region??'')?'zh-Hant':'zh-Hans';
      if(available.some(language=>language.id===id))return id;
      continue;
    }
    const exact=available.find(language=>new Intl.Locale(language.id).baseName===locale.baseName);
    if(exact)return exact.id;
    const matches=available.filter(language=>{const candidate=new Intl.Locale(language.id);return candidate.language===locale.language && (!locale.script || !candidate.script || candidate.script===locale.script);});
    const generic=matches.find(language=>new Intl.Locale(language.id).baseName===locale.language);
    if(generic)return generic.id;
    if(matches.length)return matches[0].id;
  }
  return 'zh-Hans';
}
