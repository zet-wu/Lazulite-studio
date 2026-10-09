import { expect, it } from 'vitest';
import { createLyricDocument, createWord, createLine } from '../src/domain/lyric-document';
import { createProjectDocument } from '../src/domain/project-document';
import { autoInsertCues, outputId, reconcileKaraoke } from '../src/domain/karaoke';
import { prepareNicokara, nicokaraZip, encodeKraText, safeFilename } from '../src/adapters/nicokara';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function fixture(){const p=createProjectDocument(createLyricDocument('愛'));const l=p.lyrics.lines[0];l.beginMs=20000;l.endMs=21000;Object.assign(l.words[0],{beginMs:20000,endMs:21000,rubyUnits:[{id:'r1',reading:'あ',beginMs:20200,endMs:20300},{id:'r2',reading:'い',beginMs:20600,endMs:20800}]});return p;}
it('preserves ruby leading, internal, trailing silence and manually shortened cue',()=>{
 const p=fixture();p.karaoke.defaults.rubyMs=100;p.karaoke=autoInsertCues(p.lyrics,p.karaoke);
 const cue=p.karaoke.cues.find(c=>c.anchor.kind==='ruby')!;cue.beginMs=20400;cue.endMs=20500;
 const before=structuredClone(p),out=prepareNicokara(p,'song');expect(out.issues).toEqual([]);expect(p).toEqual(before);
 expect(out.files[0].text).toContain('@Ruby1=愛,[00:00:20]あ[00:00:30][00:00:40]●[00:00:50][00:00:60]い[00:00:80],[00:20:00],[00:21:00]');
 expect(out.files[0].text.startsWith('\ufeff')).toBe(true);expect(out.files[0].text.endsWith('\r\n')).toBe(true);
});
it('only checks dependencies of selected auxiliary output and does not synthesize text',()=>{
 const p=fixture(),l=p.lyrics.lines[0];l.words[0].rubyUnits[0].beginMs=null;
 p.lyrics.translationTracks=[{id:'t',language:'zh-CN',purpose:'replacement',contents:[{id:'c',lineId:l.id,kind:'plain',text:'爱'}]}];
 p.karaoke.outputs=[outputId('main','translation','t')];
 const out=prepareNicokara(p,'song');expect(out.issues).toEqual([]);expect(out.files[0].name).toBe('song.main.translation.zh-CN.kra');expect(out.files[0].text).toBe('\ufeff[00:20:00]爱[00:21:00]\r\n');
 p.karaoke.outputs.push(outputId('main'));expect(prepareNicokara(p,'song').issues.some(i=>i.kind==='ruby')).toBe(true);
});
it('quantizes absolute times before relative offsets, blocks collapse and ambiguous ruby instances',()=>{
 const p=fixture(),l=p.lyrics.lines[0],w=l.words[0];w.beginMs=20009;w.rubyUnits[0].beginMs=20201;
 expect(prepareNicokara(p,'s').files[0].text).toContain('[00:00:20]あ');
 w.rubyUnits[0].endMs=20209;expect(prepareNicokara(p,'s').issues.some(i=>i.message.includes('零时长'))).toBe(true);
 w.rubyUnits[0].endMs=20300;
 const second=createLine('愛');Object.assign(second,{beginMs:20000,endMs:21000});Object.assign(second.words[0],{beginMs:20008,endMs:21000,rubyUnits:[{id:'different',reading:'え',beginMs:20008,endMs:21000}]});p.lyrics.lines.push(second);p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);
 expect(prepareNicokara(p,'s').issues.filter(i=>i.message.includes('另一对象'))).toHaveLength(2);
 p.karaoke.lineGroups[second.id]='background';p.karaoke.outputs=[outputId('main')];expect(prepareNicokara(p,'s').issues).toEqual([]);
});
it('canonicalizes chorus, carries singer state and explicitly resets unnamed passages',()=>{
 const p=fixture(),l=p.lyrics.lines[0];l.words[0].rubyUnits=[];p.lyrics.agents=[{id:'b',name:'B',type:'person'},{id:'a',name:'A',type:'person'}];l.agentRefs=['a','b'];
 l.words.push({...createWord('次'),beginMs:22000,endMs:23000,agentRefs:['b','a']});const other=createLine('無');Object.assign(other.words[0],{beginMs:24000,endMs:25000});Object.assign(other,{beginMs:24000,endMs:25000});p.lyrics.lines.push(other);p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);
 const out=prepareNicokara(p,'s');expect(out.issues).toEqual([]);expect(out.files[0].text.match(/【B\+A】/g)).toHaveLength(1);expect(out.files[0].text).toContain('【】無');
 p.lyrics.agents.push({id:'c',name:'B+A',type:'person'});other.agentRefs=['c'];expect(prepareNicokara(p,'s').issues.some(i=>i.message.includes('相同标记'))).toBe(true);
});
it('encodes field commas and references without stripping punctuation or variation selectors',()=>{
 expect(encodeKraText('a,b&[00:01:00]❤️',true)).toBe('a&#44;b&#38;&#91;00:01:00&#93;❤️');
 const p=fixture();p.lyrics.metadata={title:['a\nb','c'],songwriter:['Ignored'],isrc:['Ignored']};const text=prepareNicokara(p,'s').files[0].text;expect(text).toContain('@Title=a b / c\r\n');expect(text).not.toContain('Ignored');
});
it('creates an independently readable ZIP with UTF-8 BOM and unique safe names',()=>{
 const p=fixture();p.karaoke.groups.push({id:'MAIN',name:'collision'});const other=createLine('B');Object.assign(other.words[0],{beginMs:20000,endMs:21000});p.lyrics.lines.push(other);p.karaoke.lineGroups[other.id]='MAIN';p.karaoke.outputs.push(outputId('MAIN'));
 const zip=nicokaraZip(p,'../曲:*'),dir=mkdtempSync(join(tmpdir(),'kra-')),file=join(dir,'a.zip');
 try{writeFileSync(file,zip);const names=JSON.parse(execFileSync('python',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert all(z.read(n).startswith(bytes([239,187,191])) for n in z.namelist()); print(json.dumps(z.namelist()))',file],{encoding:'utf8'}));expect(names).toHaveLength(3);expect(new Set(names.map((n:string)=>n.toLowerCase())).size).toBe(3);expect(names.every((n:string)=>!n.includes('/'))).toBe(true);}finally{rmSync(dir,{recursive:true,force:true});}
 expect(safeFilename('CON')).toBe('_CON');
});
it('detects a Ruby base crossing a neighboring word boundary',()=>{
 const p=fixture(),l=p.lyrics.lines[0];l.words[0].text='二人';
 const other=createLine('二');Object.assign(other.words[0],{beginMs:20000,endMs:20500});other.words.push({...createWord('人'),beginMs:20500,endMs:21000});p.lyrics.lines.push(other);p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);
 expect(prepareNicokara(p,'s').issues.some(i=>i.message.includes('子串'))).toBe(true);
});
