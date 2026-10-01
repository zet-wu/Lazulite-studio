// Search variants and weighted fuzz scoring follow Lazulite lyrics/search.py.
/* CJK comparison variants adapted from MusicBox candidateMatching.ts.
MIT License

Copyright (c) 2025-present asxez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { Converter } from 'opencc-js/t2cn';
import { partial_ratio, ratio } from 'fuzzball';
import type { Candidate } from '../adapters/http/lyric-sources';
import type { SearchConditions } from '../features/useSearchConditions';
const converters = ['t','tw','hk','jp'].map(from => Converter({ from, to: 'cn' }));
const spaces = (value: string) => value.replace(/\s+/g, ' ').trim();
function normalizeSearch(value: string) {
  return spaces(value.normalize('NFKC').replace(/[’`]/g,"'").replace(/[“”]/g,'"').replace(/[☆★~～]/g,' ').replace(/[\u2010-\u2014\u2212]/g,'-'));
}
function stripBracket(value: string) { return spaces(normalizeSearch(value).replace(/[([（【].*?[)\]）】]/g,' ')).replace(/^[ ._\-]+|[ ._\-]+$/g,''); }
export function titleVariants(title: string): string[] {
  const stripped = stripBracket(title);
  return [...new Set([spaces(title), normalizeSearch(title), stripped, spaces(stripped.replace(/[^0-9A-Za-z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\s'\-]+/g,' ')).replace(/^[ ._\-]+|[ ._\-]+$/g,'')].filter(Boolean))];
}
function comparisonVariants(value: string) {
  const raw = normalizeSearch(value).toLocaleLowerCase();
  const bare = raw.replace(/(?:feat\.?|ft\.?).*$/i,'').replace(/[\s_'"“”‘’·・.()[\]{}（）【】]/g,'').trim();
  if (!bare) return [];
  const expanded = [...bare].map((c,i,chars) => c === '々' && i && /\p{Script=Han}/u.test(chars[i-1]) ? chars[i-1] : c).join('');
  const variants = new Set([raw, stripBracket(raw), bare, stripBracket(raw).replace(/\s/g,''), expanded]);
  for (const part of [...variants]) variants.add([...part].map((c,i,chars) => c === '々' && i && /\p{Script=Han}/u.test(chars[i-1]) ? chars[i-1] : c).join(''));
  for (const convert of converters) for (const part of [...variants]) variants.add(convert(part));
  return [...variants].filter(Boolean);
}
const fuzzyOptions = { full_process: false };
function similarity(left: string, right: string, fullWeight: number) {
  let score = 0;
  for (const l of comparisonVariants(left)) for (const r of comparisonVariants(right)) score = Math.max(score, partial_ratio(l,r,fuzzyOptions)*(1-fullWeight)+ratio(l,r,fuzzyOptions)*fullWeight);
  return score;
}
export function identityScore(query: SearchConditions, candidate: Candidate) {
  const albumWeight = query.album.trim() ? .2 : 0, artistWeight = query.artist.trim() ? .1 : 0;
  const title = similarity(query.title,candidate.title,.4);
  const album = candidate.album ? similarity(query.album,candidate.album,.3) : 0;
  const artist = Math.max(0, ...candidate.artists.map(value=>similarity(query.artist,value,.2)));
  return (.7*title + albumWeight*album + artistWeight*artist)/(.7+albumWeight+artistWeight);
}
export function compareCandidates(query: SearchConditions, left: Candidate, right: Candidate) {
  return identityScore(query,right)-identityScore(query,left) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
