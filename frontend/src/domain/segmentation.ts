import { createWord, type LyricDocument, type LyricWord } from './lyric-document';
import { isGraphemeBoundary } from './text-boundaries';

export const SYLLABLE_LANGUAGES = [
  ['en-us', 'English (US)'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'],
  ['id', 'Bahasa Indonesia'], ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'],
] as const;
export type SyllableLanguage = typeof SYLLABLE_LANGUAGES[number][0];
export type SegmentOptions = {
  splitCjk: boolean;
  western: 'word' | 'syllable';
  language: SyllableLanguage;
  punctuation: 'merge' | 'separate';
  whitespace: 'separate' | 'previous' | 'next';
  punctuationWeight: number;
  ignore: string[];
  rules: Array<{ source: string; parts: string[] }>;
};
export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  splitCjk: true, western: 'word', language: 'en-us', punctuation: 'merge',
  whitespace: 'next', punctuationWeight: 0.2, ignore: [], rules: [],
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string) => Array.from(segmenter.segment(text), (item) => item.segment);
const isSpace = (text: string) => /^\s+$/u.test(text);
const isPunctuation = (text: string) => /^[\p{P}\p{S}]+$/u.test(text);
const isCjk = (text: string) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(text);
const isWestern = (text: string) => /^[\p{L}\p{M}\p{N}]+$/u.test(text) && !isCjk(text);

export function validateSegmentOptions(options: SegmentOptions): void {
  if (!Number.isFinite(options.punctuationWeight) || options.punctuationWeight < 0) throw new Error('标点时间权重必须是非负数');
  for (const rule of options.rules) {
    if (!rule.source || rule.parts.length < 2 || rule.parts.some((part) => !part) || rule.parts.join('') !== rule.source) throw new Error(`自定义规则必须完整保留原文：${rule.source}`);
    let offset = 0;
    for (const part of rule.parts.slice(0, -1)) {
      offset += Array.from(part).length;
      if (!isGraphemeBoundary(rule.source, offset)) throw new Error(`自定义规则切开了字符：${rule.source}`);
    }
  }
}

export async function loadSyllableDivider(language: SyllableLanguage): Promise<(text: string) => string[]> {
  const module = await ({
    'en-us': () => import('hyphen/en-us'), de: () => import('hyphen/de'), fr: () => import('hyphen/fr'),
    es: () => import('hyphen/es'), id: () => import('hyphen/id'), it: () => import('hyphen/it'),
    pt: () => import('hyphen/pt'), ru: () => import('hyphen/ru'),
  }[language]());
  return (text) => module.hyphenateSync(text).split('\u00ad');
}

function tokenizeRaw(text: string, options: SegmentOptions, divide?: (text: string) => string[]): string[] {
  const protectedTerms = [...new Set([...options.ignore, ...options.rules.map((rule) => rule.source)])]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const tokens: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const protectedTerm = protectedTerms.find((term) => text.startsWith(term, offset) &&
      isGraphemeBoundary(text, Array.from(text.slice(0, offset)).length) &&
      isGraphemeBoundary(text, Array.from(text.slice(0, offset + term.length)).length));
    if (protectedTerm) {
      tokens.push(...(options.rules.find((rule) => rule.source === protectedTerm)?.parts ?? [protectedTerm]));
      offset += protectedTerm.length;
      continue;
    }
    const remainder = text.slice(offset);
    const first = graphemes(remainder)[0];
    const category = isSpace(first) ? 'space' : isPunctuation(first) ? 'punctuation' : isCjk(first) ? 'cjk' : isWestern(first) ? 'western' : 'other';
    if (category === 'cjk' && options.splitCjk || category === 'punctuation' || category === 'other') {
      tokens.push(first); offset += first.length; continue;
    }
    let run = first;
    for (const part of graphemes(remainder.slice(first.length))) {
      const same = category === 'space' ? isSpace(part) : category === 'cjk' ? isCjk(part) : isWestern(part);
      if (!same || protectedTerms.some((term) => remainder.startsWith(term, run.length))) break;
      run += part;
    }
    if (category === 'western' && options.western === 'syllable') tokens.push(...(divide?.(run) ?? [run]));
    else tokens.push(run);
    offset += run.length;
  }
  return tokens;
}

export function segmentText(text: string, options: SegmentOptions, divide?: (text: string) => string[]): string[] {
  validateSegmentOptions(options);
  const raw = tokenizeRaw(text, options, divide);
  const result: string[] = [];
  let prefix = '';
  for (const token of raw) {
    if (isSpace(token) && options.whitespace !== 'separate') {
      if (options.whitespace === 'previous' && result.length) result[result.length - 1] += token;
      else prefix += token;
    } else if (isPunctuation(token) && options.punctuation === 'merge') {
      if (/[（(「『“‘]$/u.test(token) || !result.length || prefix) prefix += token;
      else result[result.length - 1] += token;
    } else {
      result.push(prefix + token);
      prefix = '';
    }
  }
  if (prefix) {
    if (result.length) result[result.length - 1] += prefix;
    else result.push(prefix);
  }
  if (result.join('') !== text) throw new Error('分词结果未保留原文');
  return result;
}

export function distributeSegmentTime(word: LyricWord, parts: string[], punctuationWeight: number): LyricWord[] {
  if (!parts.length || parts.join('') !== word.text || parts.some((part) => !part)) throw new Error('分词结果未保留原文');
  if (parts.length === 1) return [word];
  if (word.rubyUnits.length || word.romanization || word.alignmentUnits.length || word.obscene || word.emptyBeat) throw new Error(`词“${word.text}”包含注音或附属属性，请先手动处理`);
  const weights = parts.map((part) => graphemes(part).reduce((total, item) => total + (isSpace(item) ? 0 : isPunctuation(item) ? punctuationWeight : 1), 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const begin = word.beginUs, end = word.endUs;
  let cumulative = 0;
  return parts.map((part, index) => {
    const start = begin === null || end === null ? null : begin + Math.round((end - begin) * cumulative / (sum || parts.length));
    cumulative += sum ? weights[index] : 1;
    const finish = begin === null || end === null ? null : index === parts.length - 1 ? end : begin + Math.round((end - begin) * cumulative / (sum || parts.length));
    return { ...createWord(part, index === 0 ? word.id : crypto.randomUUID()), beginUs: start, endUs: finish };
  });
}

export function segmentationPreview(document: LyricDocument, wordIds: string[], options: SegmentOptions, divide?: (text: string) => string[]) {
  const chosen = new Set(wordIds);
  return document.lines.flatMap((line) => line.words.filter((word) => chosen.has(word.id)).map((word) => {
    const parts = segmentText(word.text, options, divide);
    const blocked = parts.length > 1 && Boolean(word.rubyUnits.length || word.romanization || word.alignmentUnits.length || word.obscene || word.emptyBeat);
    return { lineId: line.id, word, parts, blocked };
  }));
}
