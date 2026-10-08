import { expect, it } from 'vitest';
import { parsePayload } from '../src/adapters/http/lyric-sources';
import { lyricCapabilities } from '../src/adapters/lyric-capabilities';
import { createLine, createLyricDocument, createWord, plainTranslation } from '../src/domain/lyric-document';
const ttml = (body: string) => `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${body}</div></body></tt>`;
const parse = (content: string, format: 'ttml'|'lrc'|'elrc'|'eslrc' = 'ttml') => parsePayload({empty:false,format,content,metadata:{}});
it('distinguishes line-only, untimed spans, one-word and partial TTML without changing clocks', () => {
 const line = parse(ttml('<p begin="1s" end="2s"><span>hello</span></p>'));
 expect(line.badges).toContain('逐行'); expect(line.badges).not.toContain('逐词');
 expect(line.document.lines[0].words[0].beginMs).toBeNull();
 expect(parse(ttml('<p><span>hello</span></p>')).badges).toContain('无时间');
 expect(parse(ttml('<p begin="1s" end="2s"><span begin="0s" end="1s">hello</span></p>')).badges).toContain('逐词');
 expect(parse(ttml('<p begin="1s" end="2s"><span begin="0s" end="1s">hello</span> world</p>')).badges).toContain('部分定时');
});
it('includes Ruby-only clocks but never mistakes sidecar clocks for body timing', () => {
 const document = createLyricDocument(); document.lines=[createLine('字')];
 document.lines[0].words[0].rubyUnits=[{id:'r',reading:'ji',beginMs:100,endMs:200}];
 expect(lyricCapabilities(document)).toEqual(['逐词','注音']);
 const snapshot=JSON.stringify(document); lyricCapabilities(document); expect(JSON.stringify(document)).toBe(snapshot);
 document.lines[0].words=[createWord('字')];
 document.translationTracks=[{id:'t',language:null,purpose:'subtitle',contents:[plainTranslation('word',document.lines[0].id)]}];
 document.romanizationTracks=[{id:'r',language:null,contents:[{id:'c',lineId:document.lines[0].id,kind:'timed',units:[{id:'u',text:'ji',beginMs:100,endMs:200}]}]}];
 expect(lyricCapabilities(document)).toEqual(['无时间','翻译','音译']);
});
it('uses parser provenance for ordinary and both extended LRCs, including one word', () => {
 expect(parse('[00:01]hello','lrc').badges).toContain('逐行');
 expect(parse('[00:01]hello','elrc').badges).toContain('逐行');
 expect(parse('[00:01]<00:01>hello<00:02>','elrc').badges).toContain('逐词');
 expect(parse('[00:01]hello[00:02]','eslrc').badges).toContain('逐词');
 expect(parse('[00:01]hello<00:02>\n[00:03]world','lrc').badges).toContain('部分定时');
});
