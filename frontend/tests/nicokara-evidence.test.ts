import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectDocument} from '../src/domain/project-document';
import {createLyricDocument} from '../src/domain/lyric-document';
import {prepareNicokara} from '../src/adapters/nicokara';
it.skipIf(!process.env.STUDIO_KARAOKE_EVIDENCE)('writes reviewed Ruby cases for external consumer verification',()=>{
 const directory=process.env.STUDIO_KARAOKE_EVIDENCE!;mkdirSync(directory,{recursive:true});
 for(const [name,last,base] of [['flush',32920,32920],['quantized-flush',32920,32929],['tail-silence',32900,32920]] as const){
  const p=createProjectDocument(createLyricDocument('胸'));const line=p.lyrics.lines[0],word=line.words[0];line.beginMs=word.beginMs=32590;line.endMs=word.endMs=base;word.rubyUnits=[{id:'r1',reading:'む',beginMs:32590,endMs:32760},{id:'r2',reading:'ね',beginMs:32760,endMs:last}];
  const result=prepareNicokara(p,name);expect(result.issues).toEqual([]);writeFileSync(join(directory,`${name}.kra`),result.files[0].text);
 }
});
