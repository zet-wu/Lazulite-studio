import { translationText, type SubLyric } from './lyric-document';

export function validateLanguageTag(language: string | null): void {
  if (!language) return;
  if (/^x(?:-[a-z0-9]{1,8})+$/i.test(language)) return;
  try { Intl.getCanonicalLocales(language); }
  catch { throw new Error('语言标签格式无效，如 zh-Hans、en、ja'); }
}

export function nonemptyTranslations(items: SubLyric[]): SubLyric[] {
  const contentIds = new Set<string>();
  return items.filter(item => item.kind === 'timed' || translationText(item).trim()).map(item => {
    validateLanguageTag(item.language);
    if (!item.id || contentIds.has(item.id) || !item.trackId || !Number.isSafeInteger(item.trackOrder) || item.trackOrder < 0 || !Number.isSafeInteger(item.contentOrder) || item.contentOrder < 0 || !['subtitle', 'replacement'].includes(item.purpose)) throw new Error('翻译标识或用途无效');
    contentIds.add(item.id);
    if (item.kind === 'timed') {
      const ids = new Set<string>();
      for (const unit of item.units) {
        if (!unit.id || ids.has(unit.id)) throw new Error('翻译单元标识重复');
        ids.add(unit.id);
        for (const time of [unit.beginMs, unit.endMs]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new Error('翻译时间必须为非负整数毫秒');
        if (unit.beginMs !== null && unit.endMs !== null && unit.beginMs > unit.endMs) throw new Error('翻译开始不能晚于结束');
      }
    }
    return item;
  });
}
