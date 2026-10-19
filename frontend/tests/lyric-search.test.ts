import { expect, test } from 'vitest';
import { titleVariants, identityScore } from '../src/domain/lyric-search';
import type { Candidate } from '../src/adapters/http/lyric-sources';
const candidate = (patch: Partial<Candidate> = {}): Candidate => ({ source: 'netease', id: '1', title: '歌曲', artists: ['A'], album: 'B', duration_ms: null, ...patch });
test('finite title transformations keep raw version, deduplicate and never include identity fields',()=>{
 expect(titleVariants(' Ａ☆Song— (Live)！ ')).toEqual(['Ａ☆Song— (Live)！','A Song- (Live)!','A Song- !','A Song']);
 expect(titleVariants('Song')).toEqual(['Song']); expect(titleVariants('   ')).toEqual([]);
});
test('identity score follows weighted fuzzy matching and CJK views without changing labels',()=>{
 const query={title:'國々 (Live)',artist:'A',album:'B'};
 const exact=candidate({title:'国国',duration_ms:999999999});
 expect(identityScore(query,exact)).toBeCloseTo(100);
 const missing=candidate({title:'国国',artists:[],album:''});
 expect(identityScore(query,missing)).toBeCloseTo(70);
 expect(identityScore({...query,artist:'',album:''},missing)).toBeCloseTo(100);
 expect(query.title).toBe('國々 (Live)'); expect(exact.title).toBe('国国');
});
