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
function fixture(audio=wav(),short=false){
 const doc=createProjectDocument();doc.lyrics.lines=[{...createLine('','l'),beginMs:1000,endMs:short?2000:20000,words:[{...createWord('愛','w'),beginMs:1000,endMs:1800,rubyUnits:[{id:'r1',reading:'あ',beginMs:1000,endMs:1400},{id:'r2',reading:'い',beginMs:1420,endMs:1800}]},{...createWord('love','western'),beginMs:1800,endMs:2000}]}];
 doc.acoustics={analysisId:'selected',segments:[{id:'s',beginMs:900,endMs:1900}]};
 const urls:URL[]=[];
 const f=projectFixture(doc,url=>{
  urls.push(url);
  if(url.pathname==='/api/v1/projects/p')return Response.json({asset:{id:'asset',source_duration_ms:30000,duration_ms:30000}});
  if(url.pathname.endsWith('/vocals'))return Response.json({items:['other','selected'].map(id=>({id,source_asset_id:'asset',audio_state:'current',status:'ready',duration_ms:25000}))});
  if(url.pathname.endsWith('/audio-excerpt'))return new Response(audio,{headers:{'X-Actual-Start-Ms':url.searchParams.get('start_ms')!,'X-Actual-End-Ms':String(Number(url.searchParams.get('start_ms'))+Math.max(0,(audio.length-44)/32))}});
  throw new Error(`Unexpected ${url}`);
 },'asset');return {...f,urls};
}
it('returns a decodable PNG, exact numbered leaves, saved segments and actual excerpt bounds without writes',async()=>{
 const f=fixture(),registry=createToolRegistry();
 const payload=await registry.call('get_timeline_visual',{project_id:'p',start_ms:1000,end_ms:2200},f) as McpToolPayload;
 expect(payload.content.map(c=>c.type)).toEqual(['text','image']);
 const text=payload.content[0];if(text.type!=='text')throw new Error('Missing metadata');const meta=JSON.parse(text.text);
 expect(meta).toMatchObject({revision:'r1',source:'vocal',vocal_result_id:'selected',actual_range_ms:[1000,2000],duration_ms:1000,image_size:[840,280],segments_in_window:[{segment_id:'s',begin_ms:900,end_ms:1900}]});
 expect(meta.units).toEqual([
  {index:1,unit_id:'r1',word_id:'w',line_id:'l',kind:'ruby',text:'あ',begin_ms:1000,end_ms:1400,duration_ms:400},
  {index:2,unit_id:'r2',word_id:'w',line_id:'l',kind:'ruby',text:'い',begin_ms:1420,end_ms:1800,duration_ms:380},
  {index:3,unit_id:'western',word_id:'western',line_id:'l',kind:'word',text:'love',begin_ms:1800,end_ms:2000,duration_ms:200},
 ]);
 expect(meta.lines).toMatchObject([{index:1,line_id:'l',line_number:1}]);
 const block=payload.content[1];if(block.type==='text')throw new Error('Missing image');expect(block.mimeType).toBe('image/png');
 const bytes=Buffer.from(block.data,'base64');expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
 expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([840,280]);
 const chunks:Buffer[]=[];for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+size));offset+=12+size;}
 const pixels=inflateSync(Buffer.concat(chunks));expect(pixels.length).toBe((840*3+1)*280);
 // At 440 Hz the tone is visibly stronger than a quiet band at 4 kHz.
 const at=(hz:number)=>{const y=195-Math.round(Math.log(hz/80)/Math.log(100)*167);return pixels[(840*3+1)*y+1+400*3+1];};expect(at(440)).toBeGreaterThan(at(4000)+40);
 expect(f.urls.at(-1)!.searchParams.get('vocal')).toBe('selected');expect(f.writes()).toBe(0);
});
it('clamps padded line ranges to source duration and 15 seconds, allows explicit vocal selection and original audio',async()=>{
 const registry=createToolRegistry(),f=fixture();
 await registry.call('get_timeline_visual',{project_id:'p',line_id:'l',vocal_result_id:'other'},f);
 expect(f.urls.at(-1)!.searchParams.get('start_ms')).toBe('500');expect(f.urls.at(-1)!.searchParams.get('end_ms')).toBe('15500');expect(f.urls.at(-1)!.searchParams.get('vocal')).toBe('other');
 const short=fixture(wav(),true);await registry.call('get_timeline_visual',{project_id:'p',line_id:'l',padding_ms:10000,source:'original'},short);
 expect(short.urls.at(-1)!.searchParams.get('start_ms')).toBe('0');expect(short.urls.at(-1)!.searchParams.get('end_ms')).toBe('12000');expect(short.urls.at(-1)!.searchParams.has('vocal')).toBe(false);
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
