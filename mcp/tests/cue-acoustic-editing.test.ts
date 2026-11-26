import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry } from '../src/mcp-server';
import { projectFixture } from './project-fixture';

function fixture(){
 const doc=createProjectDocument();doc.lyrics.lines=[{...createLine('','l'),beginMs:2000,endMs:4000,words:[{...createWord('愛','w1'),beginMs:2000,endMs:3000,rubyUnits:[{id:'r1',reading:'あ',beginMs:2000,endMs:2500},{id:'r2',reading:'い',beginMs:2500,endMs:3000}]},{...createWord('う','w2'),beginMs:3500,endMs:4000}]}];
 return projectFixture(doc,()=>Response.json({asset:{id:'audio',source_duration_ms:5000}}));
}
it('deletes one ruby and clears word/line descendants with parent envelope policies',async()=>{
 const f=fixture(),r=createToolRegistry();
 await r.call('edit_lyrics',{project_id:'p',operations:[{op:'delete_ruby',line_id:'l',word_id:'w1',ruby_id:'r1'}]},f);
 expect(f.doc().lyrics.lines[0].words[0].rubyUnits.map(u=>u.id)).toEqual(['r2']);
 await r.call('edit_timing',{project_id:'p',operations:[{op:'clear_word_timing',line_id:'l',word_id:'w1'}]},f);
 expect(f.doc().lyrics.lines[0]).toMatchObject({beginMs:3500,endMs:4000,words:[{beginMs:null,endMs:null,rubyUnits:[{beginMs:null,endMs:null}]},{}]});
 await r.call('edit_timing',{project_id:'p',operations:[{op:'clear_line_timing',line_id:'l'}]},f);
 expect(f.doc().lyrics.lines[0]).toMatchObject({beginMs:null,endMs:null,words:[{beginMs:null,endMs:null},{beginMs:null,endMs:null}]});
 const fixed=fixture();await r.call('edit_timing',{project_id:'p',recompute_envelopes:false,operations:[{op:'clear_word_timing',line_id:'l',word_id:'w1'}]},fixed);
 expect(fixed.doc().lyrics.lines[0]).toMatchObject({beginMs:2000,endMs:4000});
 const before=f.revision();await expect(r.call('edit_lyrics',{project_id:'p',operations:[{op:'delete_ruby',line_id:'l',word_id:'w1',ruby_id:'absent'}]},f)).rejects.toBeDefined();expect(f.revision()).toBe(before);
});
it('edits acoustic segments with refs and validates duration/overlap atomically',async()=>{
 const f=fixture(),r=createToolRegistry();
 const result=await r.call('edit_acoustics',{project_id:'p',analysis_id:'ready-vocal',operations:[{op:'insert_segment',begin_ms:0,end_ms:500,client_ref:'first'},{op:'update_segment',segment_id:'first',end_ms:1000}]},f) as {created_refs:Record<string,string>};
 expect(f.doc().acoustics.segments).toEqual([{id:result.created_refs.first,beginMs:0,endMs:1000}]);expect(f.doc().acoustics.analysisId).toBe('ready-vocal');expect(f.writes()).toBe(1);
 const before=f.doc();
 for(const segments of [[{begin_ms:0,end_ms:6000}],[{begin_ms:0,end_ms:2000},{begin_ms:1000,end_ms:3000}],[{begin_ms:300,end_ms:200}]]){
  await expect(r.call('edit_acoustics',{project_id:'p',operations:[{op:'replace_segments',segments}]},f)).rejects.toBeDefined();expect(f.doc()).toEqual(before);
 }
 await expect(r.call('edit_acoustics',{project_id:'p',expected_revision:'stale',operations:[{op:'delete_segment',segment_id:result.created_refs.first}]},f)).rejects.toMatchObject({status:412});
 await r.call('edit_acoustics',{project_id:'p',operations:[{op:'delete_segment',segment_id:result.created_refs.first}]},f);expect(f.doc().acoustics.segments).toEqual([]);
});
it('roundtrips cues with explicit times, refs, gaps, paging, updates and deletes',async()=>{
 const f=fixture(),r=createToolRegistry(),anchor={kind:'before',line_id:'l'};
 const result=await r.call('edit_karaoke_cues',{project_id:'p',operations:[{op:'insert_cue',anchor,begin_ms:0,end_ms:500,client_ref:'first'},{op:'insert_cue',anchor,begin_ms:1000,end_ms:1500,client_ref:'second'},{op:'update_cue',cue_id:'second',text:'go'}]},f) as {created_refs:Record<string,string>};
 const read=await r.call('get_karaoke_cues',{project_id:'p',start_line:1,limit:1,include_available_gaps:true},f);
 expect(read).toMatchObject({revision:f.revision(),cues:[{cue_id:result.created_refs.first,anchor,problem:null},{text:'go',problem:null}],available_gaps:[{anchor,begin_ms:500,end_ms:1000},{anchor,begin_ms:1500,end_ms:2000},{anchor:{kind:'word',line_id:'l',left_id:'w1',right_id:'w2'},begin_ms:3000,end_ms:3500}]});
 await r.call('edit_karaoke_cues',{project_id:'p',operations:[{op:'delete_cue',cue_id:result.created_refs.second}]},f);
 const before=f.doc();
 await expect(r.call('edit_karaoke_cues',{project_id:'p',operations:[{op:'delete_cue',cue_id:result.created_refs.first},{op:'insert_cue',anchor,begin_ms:2000,end_ms:3000}]},f)).rejects.toBeDefined();expect(f.doc()).toEqual(before);
 await expect(r.call('edit_karaoke_cues',{project_id:'p',expected_revision:'stale',operations:[{op:'remove_line_cues',line_ids:['l']}]},f)).rejects.toMatchObject({status:412});
 await r.call('edit_karaoke_cues',{project_id:'p',operations:[{op:'remove_line_cues',line_ids:['l']},{op:'auto_insert_cues',group_ids:['main'],thresholds:{before_ms:500,word_ms:100,ruby_ms:100}}]},f);
 expect(f.doc().karaoke.cues).toHaveLength(2);
});
