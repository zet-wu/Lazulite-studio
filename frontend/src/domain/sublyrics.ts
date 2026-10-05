export function validateLanguageTag(language: string | null): void {
  if (!language) return;
  if (/^x(?:-[a-z0-9]{1,8})+$/i.test(language)) return;
  try { Intl.getCanonicalLocales(language); }
  catch { throw new Error('语言标签格式无效，如 zh-Hans、en、ja'); }
}

