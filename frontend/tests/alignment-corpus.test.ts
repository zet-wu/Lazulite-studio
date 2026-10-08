/** Opt-in real corpus adapter: uses Studio's actual parser, projector result merger and serializer. */
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { serializeProject, parseProject } from '../src/adapters/project-codec';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { mergeAlignment } from '../src/domain/alignment';
const root=process.env.STUDIO_ALIGNMENT_CORPUS;
it.skipIf(!root)('prepares real Studio snapshots or merges actual model results with one undo item',()=>{
 const output=resolve(root!,'.artifacts/studio-integration');mkdirSync(output,{recursive:true});
 for(const [id,path] of [['kouin','align-phase0/kouin.ttml'],['brave','align-phase0/brave.ttml'],['powder','align-phase0/powder.ttml'],['brilliance','align-extension/brilliance.ttml'],['rainbow','align-extension/rainbow.ttml']]){
  const p=createProjectDocument(parseLyricTtml(readFileSync(resolve(root!,'.artifacts',path),'utf8')));
  for(const key of Object.keys(p.amll) as (keyof typeof p.amll)[])p.amll[key]=false;
  if(!existsSync(resolve(output,`${id}-input.json`)))writeFileSync(resolve(output,`${id}-input.json`),JSON.stringify(serializeProject(p)));
 }
 const name=process.env.STUDIO_ALIGNMENT_ADOPT;
 if(name){
  const input=JSON.parse(readFileSync(resolve(output,`${name}-input.json`),'utf8'));
  const source=parseProject(input),actual=JSON.parse(readFileSync(resolve(output,`${name}-result.json`),'utf8'));
  const merged=mergeAlignment(source,actual.result,actual.duration_ms);
  const state=executeProjectCommand(createProjectEditorState(source),{type:'alignment',source,project:merged.project});
  expect(undoProjectCommand(state).present).toBe(source);expect(redoProjectCommand(undoProjectCommand(state)).present).toEqual(state.present);
  expect(parseProject(serializeProject(state.present))).toEqual(state.present);
  writeFileSync(resolve(output,`${name}-adopted.json`),JSON.stringify({snapshot:serializeProject(state.present),retained:merged.retained,history:state.past.length}));
 }
});
