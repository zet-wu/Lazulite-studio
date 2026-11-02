import {i18n} from '../../i18n';
import {message,MessageError} from '../../domain/messages';
import { preferences } from '../../adapters/preferences';
import { toHiragana } from 'wanakana';

export const defaultKanaHighlight = 'はへを';
const storageKey = 'lazulite-kana-highlight';
export function normalizeKanaHighlight(value: string): string {
  const chars = Array.from(toHiragana(value.normalize('NFC'), { convertLongVowelMark: false }));
  if (chars.some(char => !/^[ぁ-ゖー\s、,]$/.test(char))) throw new MessageError(message('kana.invalid'));
  return [...new Set(chars.filter(char => /^[ぁ-ゖー]$/.test(char)))].join('');
}
export const readKanaHighlight = () => preferences.getItem(storageKey) ?? defaultKanaHighlight;
export const saveKanaHighlight = (value: string) => preferences.setItem(storageKey, normalizeKanaHighlight(value));
export function kanaHighlightHint(source: string, preference: string): string {
  const normalized = toHiragana(source.normalize('NFC'), { convertLongVowelMark: false });
  const matches = Array.from(preference).filter(char => normalized.includes(char));
  return matches.length ? i18n.t('kana.hint',{characters:matches.join(i18n.t('common.listSeparator'))}) : '';
}
