import { createProjectEditing, emptyBeatCount, setEmptyBeat } from '../src/domain/project-editing';
import { expect, it } from 'vitest';
import { createLyricDocument, createWord, createLine } from '../src/domain/lyric-document';
import { proposeJapaneseRuby, japaneseRubyCommand, hasJapaneseRubyChanges } from '../src/domain/japanese-ruby';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
const range = (base: string, reading: string, line_id: string, base_start = 0) => ({ base, reading, line_id, base_start, base_end: base_start + Array.from(base).length });
it('splits okurigana, preserves properties and outer times in one undoable transaction', () => {
 const d=createLyricDocument('食べる 魂');const l=d.lines[0],w=l.words[0];w.beginMs=10;w.endMs=1011;const editing=createProjectEditing();setEmptyBeat(editing,w.id,'word',3);w.obscene=true;
 const rows=proposeJapaneseRuby(d,[l.id],[range('食べる','たべる',l.id),range('魂','たましい',l.id,4)]);
 const state=executeLyricCommand(createLyricEditorState(d,editing),japaneseRubyCommand(d,d,rows));const words=state.present.lines[0].words;
 expect(words.map(w=>w.text)).toEqual(['食','べる ','魂']);expect(emptyBeatCount(state.editing,words[0].rubyUnits[0].id)).toBe(3);expect(words.every(w=>w.obscene)).toBe(true);
 expect(words[0]).toMatchObject({beginMs:10,endMs:210});expect(words[2].rubyUnits.map(u=>u.reading)).toEqual(['た','ま','し','い']);expect(words[2].rubyUnits.at(-1)?.endMs).toBe(1011);
 expect(undoLyricCommand(state).present).toBe(d);expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
});
it('never merges original words or guesses cross-word readings',()=>{
 const d=createLyricDocument();const l=d.lines[0];l.words=['今','日'].map(t=>createWord(t));
 const rows=proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)]);expect(rows[0].blocks.map(b=>b.reading)).toEqual(['','']);expect(hasJapaneseRubyChanges(rows,d)).toBe(false);
 rows[0].blocks[0].reading='いま';const command=japaneseRubyCommand(d,d,rows);if(command.type!=='replace-document')throw Error();expect(command.document.lines[0].words.map(w=>w.text)).toEqual(['今','日']);
});
it('skip cancels unrelated splitting and all skipped produces no history',()=>{
 const d=createLyricDocument('食べる魂');const l=d.lines[0];const rows=proposeJapaneseRuby(d,[l.id],[range('食べる','たべる',l.id),range('魂','たましい',l.id,3)]);
 rows[0].blocks[0].reading='';const c=japaneseRubyCommand(d,d,rows);if(c.type!=='replace-document')throw Error();expect(c.document.lines[0].words.map(w=>w.text)).toEqual(['食べる','魂']);rows[0].blocks.at(-1)!.reading=' ';expect(()=>japaneseRubyCommand(d,d,rows)).toThrow('没有可应用');
});
it('preserves existing units on unchanged/restored/empty input and uses original envelope on edits',()=>{
 const d=createLyricDocument('今日');const l=d.lines[0],w=l.words[0];w.beginMs=0;w.endMs=1000;w.rubyUnits=[{id:'a',reading:'キョウ',beginMs:100,endMs:800}];
 const rows=proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)]);expect(rows[0].blocks[0].reading).toBe('キョウ');expect(hasJapaneseRubyChanges(rows,d)).toBe(false);
 rows[0].blocks[0].reading='きょう';const c=japaneseRubyCommand(d,d,rows);if(c.type!=='replace-document')throw Error();expect(c.document.lines[0].words[0].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['きょ',100,450],['う',450,800]]);
 rows[0].blocks[0].reading='';expect(hasJapaneseRubyChanges(rows,d)).toBe(false);rows[0].blocks[0].reading='キョウ';expect(hasJapaneseRubyChanges(rows,d)).toBe(false);
});
it.each([[null,9],[2,null],[null,null],[2,3]])('preserves partial/short endpoints %s %s',(beginMs,endMs)=>{
 const d=createLyricDocument('魂');const l=d.lines[0];Object.assign(l.words[0],{beginMs,endMs});const rows=proposeJapaneseRuby(d,[l.id],[range('魂','たましい',l.id)]);const c=japaneseRubyCommand(d,d,rows);if(c.type!=='replace-document')throw Error();const units=c.document.lines[0].words[0].rubyUnits;expect(units[0].beginMs).toBe(beginMs);expect(units.at(-1)?.endMs).toBe(endMs);if(beginMs===null||endMs===null)expect(units[1].beginMs).toBeNull();
});
it('handles non-BMP/combining clusters and ambiguous kana anchors conservatively',()=>{
 const d=createLyricDocument('𝄞食べる');const l=d.lines[0];const rows=proposeJapaneseRuby(d,[l.id],[range('食べる','たべる',l.id,1)]);expect(rows[0].blocks.map(b=>[b.text,b.reading])).toEqual([['𝄞',''],['食','た'],['べる','']]);
 const a=createLyricDocument('漢あ漢');expect(proposeJapaneseRuby(a,[a.lines[0].id],[range('漢あ漢','かああか',a.lines[0].id)])[0].blocks.filter(b=>b.editable).map(b=>b.reading)).toEqual(['','']);
});
it('rejects invalid service ranges and stale source without modifying source',()=>{
 const d=createLyricDocument('今日');const l=d.lines[0];expect(()=>proposeJapaneseRuby(d,[l.id],[range('違','ちがう',l.id)])).toThrow();const rows=proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)]);expect(()=>japaneseRubyCommand({...d},d,rows)).toThrow('源文档');expect(l.words[0].text).toBe('今日');
});
it('roundtrips main/background ruby through draft and pure TTML',()=>{
 const d=createLyricDocument('今日');const l=d.lines[0];d.lines.push({...createLine('魂','bg'),backgroundOf:l.id});for(const l of d.lines){l.beginMs=0;l.endMs=1000;l.words[0].beginMs=0;l.words[0].endMs=1000;}
 const rows=proposeJapaneseRuby(d,d.lines.map(l=>l.id),[range('今日','きょう',l.id),range('魂','たましい','bg')]);const c=japaneseRubyCommand(d,d,rows);if(c.type!=='replace-document')throw Error();for(const draft of [false,true]){const reopened=parseLyricTtml(serializeLyricTtml(c.document,{draft}));expect(reopened.lines.map(l=>l.words[0].rubyUnits.map(u=>u.reading))).toEqual([['きょ','う'],['た','ま','し','い']]);expect(reopened.lines[1].backgroundOf).toBe(reopened.lines[0].id);}
});
it('rejects an inverted existing envelope atomically',()=>{
 const d=createLyricDocument('今日');const l=d.lines[0];l.words[0].rubyUnits=[{id:'r1',reading:'きょ',beginMs:900,endMs:null},{id:'r2',reading:'う',beginMs:null,endMs:100}];const rows=proposeJapaneseRuby(d,[l.id],[]);rows[0].blocks[0].reading='こんにち';expect(()=>japaneseRubyCommand(d,d,rows)).toThrow('包络无效');expect(l.words[0].rubyUnits[0].reading).toBe('きょ');
});
it('applies all 2000 rows, including rows never mounted in the preview',()=>{
 const d=createLyricDocument();d.lines=Array.from({length:2000},(_,i)=>createLine('今日',`line${i}`));const rows=proposeJapaneseRuby(d,d.lines.map(l=>l.id),d.lines.map(l=>range('今日','きょう',l.id)));const command=japaneseRubyCommand(d,d,rows);if(command.type!=='replace-document')throw Error();expect(command.document.lines).toHaveLength(2000);expect(command.document.lines.every(l=>l.words[0].rubyUnits.map(u=>u.reading).join('|')==='きょ|う')).toBe(true);
});
it('anchors entire ranges and preserves reliable fine kanji boundaries inside words',()=>{
 for(const texts of [['夜','空','見','上','げ'],['夜空','見上','げ'],['夜空','見上げ']]){
  const d=createLyricDocument(),l=d.lines[0];l.words=texts.map(t=>createWord(t));
  const rows=proposeJapaneseRuby(d,[l.id],[range('夜','よ',l.id),range('空','ぞら',l.id,1),range('見','み',l.id,2),range('上げ','あげ',l.id,3)]);
  expect(rows[0].blocks.map(b=>[b.text,b.reading])).toEqual([['夜','よ'],['空','ぞら'],['見','み'],['上','あ'],['げ','']]);
  const c=japaneseRubyCommand(d,d,rows);if(c.type!=='replace-document')throw Error();expect(c.document.lines[0].words.map(w=>w.text)).toEqual(['夜','空','見','上','げ']);
 }
 const d=createLyricDocument(),l=d.lines[0];l.words=['見上','げ'].map(t=>createWord(t));
 expect(proposeJapaneseRuby(d,[l.id],[range('見上げ','みあげ',l.id)])[0].blocks.map(b=>b.reading)).toEqual(['みあ','']);
});
it('leaves indivisible compounds and split graphemes empty',()=>{
 for(const [base,reading] of [['海原','うなばら'],['微笑','ほほえ'],['今日','きょう']]){
  const d=createLyricDocument(),l=d.lines[0];l.words=Array.from(base).map(t=>createWord(t));expect(proposeJapaneseRuby(d,[l.id],[range(base,reading,l.id)])[0].blocks.every(b=>!b.reading)).toBe(true);
 }
 const d=createLyricDocument('漢\u{E0100}');const l=d.lines[0];expect(proposeJapaneseRuby(d,[l.id],[range('漢','かん',l.id),range('\u{E0100}','',l.id,1)])[0].blocks.map(b=>[b.text,b.reading])).toEqual([['漢\u{E0100}','']]);
});
it('keeps the finest reliable 坂道 blocks in either one word or an entire sentence',()=>{
 for(const texts of [['坂道'],['この坂道を'],['坂','道']]){
  const d=createLyricDocument(),l=d.lines[0];l.words=texts.map(text=>createWord(text));
  const offset=texts[0].startsWith('この')?2:0;
  const rows=proposeJapaneseRuby(d,[l.id],[range('坂','さか',l.id,offset),range('道','みち',l.id,offset+1)],true);
  expect(rows[0].blocks.filter(b=>b.reading).map(b=>[b.text,b.reading])).toEqual([['坂','さか'],['道','みち']]);
  expect(rows[0].blocks.some(b=>b.spans)).toBe(false);
 }
});
it('merges only an indivisible cross-word range, splitting its original words proportionally',()=>{
 const d=createLyricDocument(),l=d.lines[0];l.words=['あ今','日を坂道'].map(t=>createWord(t));
 Object.assign(l.words[0],{beginMs:100,endMs:300});Object.assign(l.words[1],{beginMs:400,endMs:800,obscene:true});
 const rows=proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id,1),range('坂','さか',l.id,4),range('道','みち',l.id,5)],true);
 expect(rows[0].blocks.map(b=>b.text)).toEqual(['あ','今日','を','坂','道']);expect(rows[0].blocks[1].spans).toHaveLength(2);
 const state=executeLyricCommand(createLyricEditorState(d),japaneseRubyCommand(d,d,rows));
 expect(state.present.lines[0].words.map(w=>w.text)).toEqual(['あ','今日','を','坂','道']);
 expect(state.present.lines[0].words[1]).toMatchObject({beginMs:200,endMs:500,obscene:true});
 expect(state.present.lines[0].words[1].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['きょ',200,350],['う',350,500]]);
 rows[0].blocks[1].reading='  ';
 const skipped=executeLyricCommand(createLyricEditorState(d),japaneseRubyCommand(d,d,rows));
 expect(skipped.present.lines[0].words.map(w=>w.text)).toEqual(['あ今','日を','坂','道']);
 expect(undoLyricCommand(state).present).toBe(d);expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
});
it.each([0,3])('uses the first merged word empty beat, including zero (%s)',count=>{
 const d=createLyricDocument(),l=d.lines[0];l.words=['今','日'].map(t=>createWord(t));
 const editing=createProjectEditing();setEmptyBeat(editing,l.words[0].id,'word',count);setEmptyBeat(editing,l.words[1].id,'word',5);
 const rows=proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)],true);
 const state=executeLyricCommand(createLyricEditorState(d,editing),japaneseRubyCommand(d,d,rows));
 const merged=state.present.lines[0].words[0];expect(merged.id).toBe(l.words[0].id);expect(emptyBeatCount(state.editing,merged.rubyUnits[0].id)).toBe(count);
 expect(state.editing.emptyBeats[l.words[1].id]).toBeUndefined();expect(undoLyricCommand(state).editing).toEqual(editing);
});
it('does not merge across existing ruby, whitespace, punctuation, or independent lines',()=>{
 for(const texts of [['今','日'],['今',' ','日'],['今','、','日']]){
  const d=createLyricDocument(),l=d.lines[0];l.words=texts.map(t=>createWord(t));
  if(texts.length===2)l.words[0].rubyUnits=[{id:'old',reading:'いま',beginMs:null,endMs:null}];
  const rows=proposeJapaneseRuby(d,[l.id],[range(texts.join(''),'きょう',l.id)],true);
  expect(rows[0].blocks.some(b=>b.spans)).toBe(false);
 }
 const d=createLyricDocument('今\n日');const rows=proposeJapaneseRuby(d,d.lines.map(l=>l.id),[],true);expect(rows.every(r=>r.blocks.every(b=>!b.spans))).toBe(true);
});
it.each([[null,9],[2,null],[null,null],[2,3]])('merging retains known endpoint envelope %s %s',(beginMs,endMs)=>{
 const d=createLyricDocument(),l=d.lines[0];l.words=['今','日'].map(t=>createWord(t));l.words[0].beginMs=beginMs;l.words[1].endMs=endMs;
 const state=executeLyricCommand(createLyricEditorState(d),japaneseRubyCommand(d,d,proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)],true)));
 expect(state.present.lines[0].words[0]).toMatchObject({beginMs,endMs});
});
it('merging reconciles invalid cue anchors and keeps external links in the same project history',()=>{
 const d=createLyricDocument(),l=d.lines[0];l.beginMs=0;l.endMs=1000;
 l.words=[{...createWord('今'),beginMs:100,endMs:300},{...createWord('日'),beginMs:500,endMs:700}];
 const next={...createLine('かな'),beginMs:1000,endMs:2000};d.lines.push(next);
 const editing=createProjectEditing();editing.endLinks[l.id]=next.id;
 const initial=createLyricEditorState(d,editing);
 initial.project.present.karaoke.cues=[{id:'between',text:'●',anchor:{kind:'word',lineId:l.id,leftId:l.words[0].id,rightId:l.words[1].id},beginMs:300,endMs:500},{id:'before',text:'●',anchor:{kind:'before',lineId:l.id},beginMs:0,endMs:100}];
 const state=executeLyricCommand(initial,japaneseRubyCommand(d,d,proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)],true)));
 expect(state.project.present.karaoke.cues.map(c=>c.id)).toEqual(['before']);expect(state.editing.endLinks).toEqual(editing.endLinks);
 expect(undoLyricCommand(state).project.present).toEqual(initial.project.present);expect(redoLyricCommand(undoLyricCommand(state)).project.present).toEqual(state.project.present);
});
it('rejects merged incompatible agents and existing ruby beat loss without modifying any source',()=>{
 const d=createLyricDocument(),l=d.lines[0];d.agents=[{id:'a',name:null,type:'person'},{id:'b',name:null,type:'person'}];
 l.words=[{...createWord('今'),agentRefs:['a']},{...createWord('日'),agentRefs:['b']}];const before=structuredClone(d);
 expect(()=>japaneseRubyCommand(d,d,proposeJapaneseRuby(d,[l.id],[range('今日','きょう',l.id)],true))).toThrow('统一有效歌手');expect(d).toEqual(before);
 const source=createLyricDocument('今日'),word=source.lines[0].words[0];word.rubyUnits=[{id:'kept',reading:'きょう',beginMs:null,endMs:null}];
 const editing=createProjectEditing();setEmptyBeat(editing,'kept','ruby',2);const rows=proposeJapaneseRuby(source,[source.lines[0].id],[]);rows[0].blocks[0].reading='こんにち';
 const initial=createLyricEditorState(source,editing);expect(()=>executeLyricCommand(initial,japaneseRubyCommand(source,source,rows))).toThrow('空拍');expect(initial.present).toBe(source);expect(initial.past).toHaveLength(0);
});
it.each([[2,3],[null,3],[2,null]])('splitting retains exact outer endpoints and never invents partial internal time (%s, %s)',(beginMs,endMs)=>{
 const d=createLyricDocument('坂道'),l=d.lines[0];Object.assign(l.words[0],{beginMs,endMs});
 const state=executeLyricCommand(createLyricEditorState(d),japaneseRubyCommand(d,d,proposeJapaneseRuby(d,[l.id],[range('坂','さか',l.id),range('道','みち',l.id,1)])));
 const words=state.present.lines[0].words;expect(words[0].beginMs).toBe(beginMs);expect(words[1].endMs).toBe(endMs);
 expect(words[0].endMs).toBe(beginMs===null||endMs===null?null:3);expect(words[1].beginMs).toBe(words[0].endMs);
});
