import {expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseTTML,stringifyTTML} from '@applemusic-like-lyrics/lyric';
import {parseLyricTtml,serializeLyricTtml} from '../src/adapters/ttml/lyric-codec';
it('records actual AMLL lyric 1.0.2 parsing and regeneration limits separately from Studio',()=>{
 const source=readFileSync('../tests/fixtures/ttml/amll-phase0-rich.ttml','utf8');
 const own=parseLyricTtml(source),formal=serializeLyricTtml(own,{draft:false});
 const external=parseTTML(formal),regenerated=stringifyTTML(external);
 const report={version:'@applemusic-like-lyrics/lyric 1.0.2',studioBackgrounds:own.lines.filter(l=>l.backgroundOf).length,externalLines:external.lines.map(line=>({background:line.isBG,text:line.words.map(w=>w.word).join(''),translation:line.translatedLyric,roman:line.romanLyric})),regenerated};
 writeFileSync('/tmp/amll-external.json',JSON.stringify(report,null,2));
 expect(report.studioBackgrounds).toBe(2);
 expect(external.lines.length).toBeGreaterThan(0);
});
