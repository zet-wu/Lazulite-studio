import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { renderLrc } from '../src/adapters/lrc';
const line = (text: string, begin: number, end: number | null) => ({ ...createLine(text), beginMs: Math.round(begin), endMs: end === null ? null : Math.round(end) });
const doc = (...lines: ReturnType<typeof line>[]) => ({ ...createLyricDocument(), lines });
it('preserves chorus and clears only outside union, without mutation', () => {
 const d = doc(line('甲', 1000, 4000), line('乙', 2000, 5000), line('丙', 2000, 3000), line('丁', 6000, 7000)), before = JSON.stringify(d);
 expect(renderLrc(d)).toEqual({ text: '[00:01.000]甲\n[00:02.000]乙\n[00:02.000]丙\n[00:05.000]\n[00:06.000]丁\n[00:07.000]\n', overlapLines: [1, 2, 3] }); expect(JSON.stringify(d)).toBe(before);
});
it('encodes word pauses and untimed whitespace', () => {
 const a = line('', 1000, 3000); a.words = [{ ...createWord('你'), beginMs: 1000, endMs: 2000 }, createWord(' '), { ...createWord('好'), beginMs: 2500, endMs: 3000 }];
 expect(renderLrc(doc(a), 'elrc').text).toBe('[00:01.000]你<00:02.000> <00:02.500>好<00:03.000>\n[00:03.000]\n');
});
it('does not infer ends or include background', () => {
 expect(renderLrc(doc(line('甲', 1000, null), { ...line('背景', 2000, 3000), backgroundOf: 'parent' }, line('乙', 4000, 5000))).text).toBe('[00:01.000]甲\n[00:04.000]乙\n');
});
it('rejects internal overlap only in extended LRC', () => {
 const a = line('', 1000, 5000); a.words = [{ ...createWord('甲'), beginMs: 1000, endMs: 3000 }, { ...createWord('乙'), beginMs: 2000, endMs: null }];
 expect(() => renderLrc(doc(a), 'elrc')).toThrow('第 1 行第 2 词'); expect(renderLrc(doc(a)).text).toContain('甲乙');
});
it('rounds before gap comparisons', () => { expect(renderLrc(doc(line('甲', 1000, 2000.4), line('乙', 2000.49, 3000))).text).toBe('[00:01.000]甲\n[00:02.000]乙\n[00:03.000]\n'); });
