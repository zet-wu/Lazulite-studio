import {expect,it} from 'vitest';
import {createLyricDocument,createWord} from '../src/domain/lyric-document';
import {stagingItems} from '../src/features/editor/staging-layout';
it.each([
 [' ',' ',false],[' ','  ',false],[' ','　',true],[' ','\t',true],[' ','你 好',true],[' ，。',' ，',false],[' ，。','你好。',true],['',' ',true],[' ','',true],['😀😀','😀',false],['👩‍💻','👩‍💻',false],['é','é',true],
])('filters code points without normalization (%j, %j)',(ignored,text,shown)=>{
 const doc=createLyricDocument('x');doc.lines[0].words=[createWord(text)];
 expect(stagingItems(doc,null,ignored).some(item=>item.target.kind==='word')).toBe(shown);
});
it('restores ignored ancestors only as context, then removes them when no pending descendant needs them',()=>{
 const doc=createLyricDocument(' '),word=doc.lines[0].words[0];
 word.rubyUnits=[{id:'r',reading:'a',beginMs:null,endMs:null}];
 const items=stagingItems(doc,null,' ');
 expect(items.map(item=>[item.target.kind,item.assignable])).toEqual([['line',false],['word',false],['ruby',true]]);
 expect(items[1]).toMatchObject({beginMissing:true,endMissing:true});
 word.rubyUnits[0].reading=' ';
 expect(stagingItems(doc,null,' ')).toEqual([]);
});
