import { expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry } from '../src/mcp-server';
import { excerptPcm } from '../src/timeline-visual';
import type { McpToolPayload } from '../src/tools/registry';
import { projectFixture } from './project-fixture';

function wav(duration=1000){
 const frames=duration*16,buffer=Buffer.alloc(44+frames*2);
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)buffer.writeInt16LE(Math.round(14000*Math.sin(2*Math.PI*440*i/16000)),44+i*2);
 return buffer;
}
function decodePngPixels(bytes:Buffer){
 expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 const chunks:Buffer[]=[];
 for(let offset=8;offset<bytes.length;){
  const size=bytes.readUInt32BE(offset);
  if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+size));
  offset+=12+size;
 }
 const pixels=inflateSync(Buffer.concat(chunks));
 expect(pixels.length).toBe((width*3+1)*height);
 for(let y=0;y<height;y++){
  const row=y*(width*3+1);expect(pixels[row]).toBe(1);
  for(let x=3;x<width*3;x++)pixels[row+1+x]=(pixels[row+1+x]+pixels[row+1+x-3])&255;
 }
 return {width,height,pixels};
}
function fixture(audio=wav(),options:{short?:boolean;vocalStatus?:string;actualRange?:[number,number];jobs?:Record<string,{job:Record<string,unknown>;result?:Record<string,unknown>}>}={}){
 const doc=createProjectDocument();doc.lyrics.lines=[{...createLine('','l'),beginMs:1000,endMs:options.short?2000:20000,words:[{...createWord('愛','w'),beginMs:1000,endMs:1800,rubyUnits:[{id:'r1',reading:'あ',beginMs:1000,endMs:1400},{id:'r2',reading:'い',beginMs:1420,endMs:1800}]},{...createWord('love','western'),beginMs:1800,endMs:2000}]}];
 doc.acoustics={analysisId:'selected',segments:[{id:'s',beginMs:900,endMs:1900}]};
 const urls:URL[]=[];
 const f=projectFixture(doc,url=>{
  urls.push(url);
  if(url.pathname==='/api/v1/projects/p')return Response.json({asset:{id:'asset',source_duration_ms:30000,duration_ms:30000}});
  if(url.pathname.endsWith('/vocals'))return Response.json({items:['other','selected'].map(id=>({id,source_asset_id:'asset',audio_state:'current',status:options.vocalStatus??'ready',duration_ms:25000}))});
  if(url.pathname.endsWith('/energy')){
   const rawStart=url.searchParams.get('start_ms')??'',rawEnd=url.searchParams.get('end_ms')??'';
   if(!/^\d+$/.test(rawStart)||!/^\d+$/.test(rawEnd)||Number(rawEnd)<=Number(rawStart)){
    return Response.json({detail:'int_parsing'},{status:422});
   }
   const start=Number(rawStart);
   return Response.json({start_ms:start,step_ms:25,values:Array.from({length:40},(_,i)=>i<8?0.02:i<24?0.45:0.15)});
  }
  if(url.pathname.endsWith('/audio-excerpt')){
   const actualStart=options.actualRange?options.actualRange[0]:Number(url.searchParams.get('start_ms'));
   const actualEnd=options.actualRange?options.actualRange[1]:actualStart+Math.max(0,(audio.length-44)/32);
   return new Response(audio,{headers:{'X-Actual-Start-Ms':String(actualStart),'X-Actual-End-Ms':String(actualEnd)}});
  }
  const jobMatch=url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)(\/result)?$/);
  if(jobMatch&&options.jobs?.[jobMatch[1]]){
   const entry=options.jobs[jobMatch[1]];
   return Response.json(jobMatch[2]?{schema_version:'studio-job-result-v1',job_id:jobMatch[1],...entry.result}:entry.job);
  }
  throw new Error(`Unexpected ${url}`);
 },'asset');return {...f,urls};
}
function alignmentJob(id:string,overrides:{
 revision?:string;
 assetId?:string;
 status?:string;
 kind?:string;
 projectId?:string;
 modelName?:string;
 smartExtend?:boolean;
 mergeShortGaps?:boolean;
 gapThresholdMs?:number;
 selection?:string[]|null;
 timings?:Record<string,{begin:number;end:number}>;
}={}){
 const revision=overrides.revision??'r1';
 const selection=overrides.selection===undefined?null:overrides.selection;
 const allLeaves=[
  {object_id:'r1',word_id:'w',line_id:'l',kind:'ruby' as const},
  {object_id:'r2',word_id:'w',line_id:'l',kind:'ruby' as const},
  {object_id:'western',word_id:'western',line_id:'l',kind:'word' as const},
 ];
 const activeLeaves=selection?allLeaves.filter(leaf=>selection.includes(leaf.object_id)):allLeaves;
 const timings=overrides.timings??{r1:{begin:1000,end:1400},r2:{begin:1420,end:1800},western:{begin:1800,end:2000}};
 const mapping=activeLeaves.map((leaf,idx)=>({unit_id:`u${idx+1}`,...leaf}));
 const scope=activeLeaves.map((leaf,idx)=>({...leaf,target_ids:[`u${idx+1}`]}));
 const units=mapping.map(item=>({
  unit_id:item.unit_id,
  line_id:item.line_id,
  proposed_timing:{
   start:{time:timings[item.object_id].begin/1000,source:'model'},
   end:{time:timings[item.object_id].end/1000,source:'model'},
  },
 }));
 const object_timings=Object.fromEntries(activeLeaves.map(leaf=>[leaf.object_id,{
  start:{time:timings[leaf.object_id].begin/1000,source:'object_envelope'},
  end:{time:timings[leaf.object_id].end/1000,source:overrides.smartExtend?'smart_end_extension':'object_envelope'},
 }]));
 return {
  job:{
   schema_version:'studio-job-v1',
   id,
   project_id:overrides.projectId??'p',
   kind:overrides.kind??'alignment',
   status:overrides.status??'succeeded',
   stage:'done',
   acknowledged_state:null,
   result_available:(overrides.status??'succeeded')==='succeeded',
   error:null,
   engine:{},
   created_at:'2026-11-26T00:00:00Z',
   updated_at:'2026-11-26T00:00:00Z',
   request:{
    revision,
    model:{alignment:{id:overrides.modelName??'mms-fa',name:overrides.modelName??'MMS_FA'}},
    audio_source:'vocals',
    crop_vocals:true,
    smart_extend:Boolean(overrides.smartExtend),
    clear_unmatched:false,
    merge_short_gaps:Boolean(overrides.mergeShortGaps),
    gap_threshold_ms:overrides.gapThresholdMs??500,
    use_hints:false,
    convert_particles:true,
    latin_normalize:true,
    strip_tone_digits:false,
    reused_vocal:true,
   },
  },
  result:{
   kind:'alignment',
   selection,
   binding:{project_id:overrides.projectId??'p',revision,asset_id:overrides.assetId??'asset'},
   alignment:{schema:'lazulite-japanese-result-v1',units,execution:{backend:{model_name:overrides.modelName??'MMS_FA'}}},
   mapping,
   scope,
   acoustics:null,
   object_timings,
  },
 };
}

it('returns a decodable PNG with vocal RMS energy, exact numbered leaves, saved segments and actual excerpt bounds without writes',async()=>{
 const f=fixture(),registry=createToolRegistry();
 const payload=await registry.call('get_timeline_visual',{project_id:'p',start_ms:1000,end_ms:2200},f) as McpToolPayload;
 expect(payload.content.map(c=>c.type)).toEqual(['text','image']);
 const text=payload.content[0];if(text.type!=='text')throw new Error('Missing metadata');const meta=JSON.parse(text.text);
 expect(meta).toMatchObject({
  revision:'r1',source:'vocal',vocal_result_id:'selected',actual_range_ms:[1000,2000],duration_ms:1000,
  image_size:[840,330],
  energy:{included:true,vocal_result_id:'selected',upper_rms:0.5,step_ms:25,sample_count:40},
  segments_in_window:[{segment_id:'s',begin_ms:900,end_ms:1900}],
 });
 expect(meta.units).toEqual([
  {index:1,unit_id:'r1',word_id:'w',line_id:'l',kind:'ruby',text:'あ',begin_ms:1000,end_ms:1400,duration_ms:400},
  {index:2,unit_id:'r2',word_id:'w',line_id:'l',kind:'ruby',text:'い',begin_ms:1420,end_ms:1800,duration_ms:380},
  {index:3,unit_id:'western',word_id:'western',line_id:'l',kind:'word',text:'love',begin_ms:1800,end_ms:2000,duration_ms:200},
 ]);
 expect(meta.lines).toMatchObject([{index:1,line_id:'l',line_number:1}]);
 const block=payload.content[1];if(block.type==='text')throw new Error('Missing image');expect(block.mimeType).toBe('image/png');
 const {width,height,pixels}=decodePngPixels(Buffer.from(block.data,'base64'));
 expect([width,height]).toEqual([840,330]);
 // At 440 Hz the tone is visibly stronger than a quiet band at 4 kHz (spectrogram sits at y=78..246).
 const at=(hz:number)=>{const y=245-Math.round(Math.log(hz/80)/Math.log(100)*167);return pixels[(840*3+1)*y+1+400*3+1];};expect(at(440)).toBeGreaterThan(at(4000)+40);
 const energyUrl=f.urls.find(u=>u.pathname.endsWith('/energy'));
 expect(energyUrl?.searchParams.get('buckets')).toBe('792');
 expect(f.urls.find(u=>u.pathname.endsWith('/audio-excerpt'))!.searchParams.get('vocal')).toBe('selected');
 expect(f.writes()).toBe(0);
});

it('clamps padded line ranges to source duration and 15 seconds, allows explicit vocal selection and original audio without energy',async()=>{
 const registry=createToolRegistry(),f=fixture();
 await registry.call('get_timeline_visual',{project_id:'p',line_id:'l',vocal_result_id:'other'},f);
 const excerptUrl=f.urls.find(u=>u.pathname.endsWith('/audio-excerpt'))!;
 expect(excerptUrl.searchParams.get('start_ms')).toBe('500');expect(excerptUrl.searchParams.get('end_ms')).toBe('15500');expect(excerptUrl.searchParams.get('vocal')).toBe('other');
 const short=fixture(wav(),{short:true});
 const original=await registry.call('get_timeline_visual',{project_id:'p',line_id:'l',padding_ms:10000,source:'original'},short) as McpToolPayload;
 const origMeta=JSON.parse((original.content[0] as {type:'text';text:string}).text);
 expect(origMeta).toMatchObject({image_size:[840,280],energy:{included:false,vocal_result_id:null,reason:'source_is_original'}});
 expect(short.urls.some(u=>u.pathname.endsWith('/energy'))).toBe(false);
 expect(short.urls.at(-1)!.searchParams.get('start_ms')).toBe('0');expect(short.urls.at(-1)!.searchParams.get('end_ms')).toBe('12000');expect(short.urls.at(-1)!.searchParams.has('vocal')).toBe(false);
 // Separated-only vocal omits energy cleanly instead of requesting /energy.
 const sepOnly=fixture(wav(),{vocalStatus:'separated'});
 const sepPayload=await registry.call('get_timeline_visual',{project_id:'p',start_ms:1000,end_ms:2000},sepOnly) as McpToolPayload;
 expect(JSON.parse((sepPayload.content[0] as {type:'text';text:string}).text)).toMatchObject({image_size:[840,280],energy:{included:false,vocal_result_id:'selected',reason:'vocal_analysis_not_ready'}});
 expect(sepOnly.urls.some(u=>u.pathname.endsWith('/energy'))).toBe(false);
});

it('rejects oversized, conflicting, incomplete windows and empty/unsupported WAV',async()=>{
 const registry=createToolRegistry();
 for(const args of [{start_ms:0,end_ms:15001},{line_id:'l',start_ms:0,end_ms:1000},{start_ms:1},{},{start_ms:2000,end_ms:1000},{start_ms:29000,end_ms:31000},{line_id:'l',source:'original',vocal_result_id:'selected'}]){
  const f=fixture();await expect(registry.call('get_timeline_visual',{project_id:'p',...args},f)).rejects.toMatchObject({status:422});expect(f.urls.some(u=>u.pathname.endsWith('/audio-excerpt'))).toBe(false);
 }
 for(const audio of [Buffer.alloc(0),wav(0),Buffer.from('bad wave')])await expect(registry.call('get_timeline_visual',{project_id:'p',start_ms:0,end_ms:1000},fixture(audio))).rejects.toMatchObject({status:422});
 const unsupported=wav();unsupported.writeUInt32LE(48000,24);expect(()=>excerptPcm(unsupported)).toThrow('16 kHz');
 const truncated=wav().subarray(0,50);expect(()=>excerptPcm(truncated)).toThrow('Truncated');
});

it('compares current_saved against 1 or 2 unapplied alignment jobs in memory with divergence threshold and condition diffs',async()=>{
 const jobA=alignmentJob('jobA',{
  modelName:'NextFire',
  smartExtend:false,
  selection:['r1','r2'],
  timings:{r1:{begin:1000,end:1380},r2:{begin:1410,end:1800}},
 });
 const jobB=alignmentJob('jobB',{
  modelName:'MMS_FA',
  smartExtend:true,
  mergeShortGaps:true,
  gapThresholdMs:100,
  timings:{r1:{begin:1000,end:1260},r2:{begin:1300,end:1820},western:{begin:1820,end:2000}},
 });
 const f=fixture(wav(),{jobs:{jobA,jobB}}),registry=createToolRegistry();
 const payload=await registry.call('compare_alignment_results',{project_id:'p',job_ids:['jobA','jobB'],start_ms:1000,end_ms:2000},f) as McpToolPayload;
 expect(payload.content.map(c=>c.type)).toEqual(['text','image']);
 const meta=JSON.parse((payload.content[0] as {type:'text';text:string}).text);
 expect(meta).toMatchObject({
  revision:'r1',
  divergence_threshold_ms:80,
  energy:{included:true,vocal_result_id:'selected'},
  tracks:[
   {id:'current_saved',label:'CUR',name:'current_saved_timeline'},
   {id:'A',label:'A',job_id:'jobA',model_name:'NextFire'},
   {id:'B',label:'B',job_id:'jobB',model_name:'MMS_FA'},
  ],
  divergent_unit_indices:[1,2],
 });
 expect(meta.condition_differences).toEqual(expect.arrayContaining(['model','smart_extend','merge_short_gaps','gap_threshold_ms','scope_kind','scope_unit_count']));
 // jobB has merge_short_gaps=true (threshold 100 ms), so r1.end (1260) merges across the 40 ms gap to r2.begin (1300).
 expect(meta.units[0]).toMatchObject({
  index:1,unit_id:'r1',divergent:true,max_divergence_ms:100,
  current_saved:{begin_ms:1000,end_ms:1400,duration_ms:400},
  candidates:{
   A:{in_scope:true,begin_ms:1000,end_ms:1380,delta_begin_ms:0,delta_end_ms:-20},
   B:{in_scope:true,begin_ms:1000,end_ms:1300,delta_begin_ms:0,delta_end_ms:-100},
  },
  pair_delta:{begin_diff_ms:0,end_diff_ms:-80,max_abs_diff_ms:80},
 });
 // western is out of scope for local jobA, in scope for full jobB.
 expect(meta.units[2]).toMatchObject({
  index:3,unit_id:'western',divergent:false,max_divergence_ms:20,
  candidates:{
   A:{in_scope:false,begin_ms:1800,end_ms:2000,delta_begin_ms:0,delta_end_ms:0},
   B:{in_scope:true,begin_ms:1820,end_ms:2000,delta_begin_ms:20,delta_end_ms:0},
  },
 });
 const image=payload.content[1];if(image.type!=='image')throw new Error('Missing image');
 const decoded=decodePngPixels(Buffer.from(image.data,'base64'));
 expect([decoded.width,decoded.height]).toEqual(meta.image_size);
 expect(f.writes()).toBe(0);

 // Single-candidate preview with custom lower threshold flags unit 3 (20 ms shift >= 15 ms).
 const single=await registry.call('compare_alignment_results',{project_id:'p',job_ids:['jobB'],start_ms:1000,end_ms:2000,divergence_threshold_ms:15},f) as McpToolPayload;
 const singleMeta=JSON.parse((single.content[0] as {type:'text';text:string}).text);
 expect(singleMeta.tracks).toHaveLength(2);
 expect(singleMeta.divergence_threshold_ms).toBe(15);
 expect(singleMeta.divergent_unit_indices).toEqual([1,2,3]);
 expect(singleMeta.condition_differences).toEqual([]);
 expect(f.writes()).toBe(0);
});

it('rejects stale revision, duplicate, non-alignment, unfinished or mismatched-source jobs in compare_alignment_results',async()=>{
 const registry=createToolRegistry();
 const stale=fixture(wav(),{jobs:{old:alignmentJob('old',{revision:'r0'})}});
 await expect(registry.call('compare_alignment_results',{project_id:'p',job_ids:['old'],start_ms:1000,end_ms:2000},stale)).rejects.toMatchObject({status:412,body:{code:'revision_conflict'}});
 const dup=fixture(wav(),{jobs:{a:alignmentJob('a')}});
 await expect(registry.call('compare_alignment_results',{project_id:'p',job_ids:['a','a'],start_ms:1000,end_ms:2000},dup)).rejects.toMatchObject({status:422});
 const vocal=fixture(wav(),{jobs:{v:alignmentJob('v',{kind:'vocal'})}});
 await expect(registry.call('compare_alignment_results',{project_id:'p',job_ids:['v'],start_ms:1000,end_ms:2000},vocal)).rejects.toMatchObject({status:422,body:{code:'invalid_job_kind'}});
 const running=fixture(wav(),{jobs:{r:alignmentJob('r',{status:'running'})}});
 await expect(registry.call('compare_alignment_results',{project_id:'p',job_ids:['r'],start_ms:1000,end_ms:2000},running)).rejects.toMatchObject({status:409,body:{code:'result_not_ready'}});
 const wrongAsset=fixture(wav(),{jobs:{w:alignmentJob('w',{assetId:'other-asset'})}});
 await expect(registry.call('compare_alignment_results',{project_id:'p',job_ids:['w'],start_ms:1000,end_ms:2000},wrongAsset)).rejects.toMatchObject({status:409,body:{code:'source_asset_changed'}});
});

it('brackets fractional decoded excerpt bounds into integer energy queries while preserving exact actual_range_ms',async()=>{
 const actualRange:[number,number]=[1000.9977324263,1999.0022675737];
 const jobA=alignmentJob('jobA',{timings:{r1:{begin:1000,end:1380},r2:{begin:1410,end:1800},western:{begin:1800,end:2000}}});
 const f=fixture(wav(),{actualRange,jobs:{jobA}}),registry=createToolRegistry();

 const visual=await registry.call('get_timeline_visual',{project_id:'p',start_ms:1001,end_ms:1999},f) as McpToolPayload;
 const visualMeta=JSON.parse((visual.content[0] as {type:'text';text:string}).text);
 expect(visualMeta).toMatchObject({actual_range_ms:actualRange,image_size:[840,330],energy:{included:true,vocal_result_id:'selected'}});

 const compare=await registry.call('compare_alignment_results',{project_id:'p',job_ids:['jobA'],start_ms:1001,end_ms:1999},f) as McpToolPayload;
 const compareMeta=JSON.parse((compare.content[0] as {type:'text';text:string}).text);
 expect(compareMeta).toMatchObject({actual_range_ms:actualRange,energy:{included:true,vocal_result_id:'selected'}});

 const energyUrls=f.urls.filter(u=>u.pathname.endsWith('/energy'));
 expect(energyUrls).toHaveLength(2);
 for(const url of energyUrls){
  expect(url.searchParams.get('start_ms')).toBe('1000');
  expect(url.searchParams.get('end_ms')).toBe('2000');
 }
});
