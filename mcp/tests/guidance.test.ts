import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server';
import { StudioClient } from '../src/client';
import { ALIGNMENT_GUIDE_URI } from '../src/guidance';

it('advertises instructions, two usable workflow prompts and a readable guide over MCP',async()=>{
 const server=createMcpServer(new StudioClient({baseUrl:'http://localhost:15173'}));
 const client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{
  await Promise.all([server.connect(b),client.connect(a)]);
  expect(client.getInstructions()).toContain(ALIGNMENT_GUIDE_URI);
  for(const term of ['get_timeline_visual','discontiguous','not a complete error list','>1,000 ms','reverb','interlude','multilingual'])expect(client.getInstructions()).toContain(term);
  expect(client.getInstructions()).toContain('Never repeat local alignment with the same model');
  expect((await client.listTools()).tools).toHaveLength(41);
  const prompts=await client.listPrompts();expect(prompts.prompts.map(p=>p.name)).toEqual(['full_lyric_workflow','refine_alignment_anomalies']);
  for(const prompt of prompts.prompts){
   const result=await client.getPrompt({name:prompt.name,arguments:{project_id:'p',...(prompt.name==='full_lyric_workflow'?{language:'ja',quality:'fast'}:{mode:'conservative'})}});
   const content=result.messages[0].content;expect(content.type).toBe('text');if(content.type!=='text')throw new Error('Expected text');
   expect(content.text).toContain('project_id="p"');expect(content.text).toContain('scope_line_ids');expect(content.text).toContain('get_acoustics');
   for(const term of ['get_timeline_visual','continuous [min, max]','discontiguous','>1,000 ms','reverb','silence/interlude','multilingual'])expect(content.text).toContain(term);
  }
  await expect(client.getPrompt({name:'full_lyric_workflow',arguments:{project_id:'p',language:'other'}})).rejects.toBeDefined();
  const resources=await client.listResources();expect(resources.resources).toMatchObject([{uri:ALIGNMENT_GUIDE_URI,mimeType:'text/markdown'}]);
  const read=await client.readResource({uri:ALIGNMENT_GUIDE_URI});expect(read.contents[0]).toMatchObject({uri:ALIGNMENT_GUIDE_URI,mimeType:'text/markdown'});
  const resource=read.contents[0];if(!('text' in resource))throw new Error('Expected text resource');
  expect(resource.text).toContain('±300 ms');
  for(const term of ['get_timeline_visual','[L2,L9]','not a complete error list','>1,000 ms','M1/M4/M5','M3/M5','M2:'])expect(resource.text).toContain(term);
 }finally{await client.close();await server.close();}
});
