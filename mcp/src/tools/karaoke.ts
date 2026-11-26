import { z } from 'zod';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { displayLines } from '../../../frontend/src/domain/amll-compatibility';
import { gapAnchors, anchorRange, anchorKey, cueProblem, type CueAnchor, type KaraokeCommand } from '../../../frontend/src/domain/karaoke';
import { createProjectEditorState, executeProjectCommand } from '../../../frontend/src/domain/project-document';
import { id, writeSchema, invalid, requireLine, reference, remember } from './editing';
import { mutateProjectDocument } from './cas';
import { withOperationContext, type ToolRegistry } from './registry';

const millis = () => z.number().int().nonnegative();
const anchorSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('before'),line_id:id()}),
  z.object({kind:z.literal('word'),line_id:id(),left_id:id(),right_id:id()}),
  z.object({kind:z.literal('ruby'),line_id:id(),word_id:id(),left_id:id(),right_id:id()}),
]);
function anchorIn(anchor:z.infer<typeof anchorSchema>):CueAnchor {
  return anchor.kind==='before'?{kind:'before',lineId:anchor.line_id}:anchor.kind==='word'?{kind:'word',lineId:anchor.line_id,leftId:anchor.left_id,rightId:anchor.right_id}:{kind:'ruby',lineId:anchor.line_id,wordId:anchor.word_id,leftId:anchor.left_id,rightId:anchor.right_id};
}
function anchorOut(anchor:CueAnchor):z.infer<typeof anchorSchema> {
  return anchor.kind==='before'?{kind:'before',line_id:anchor.lineId}:anchor.kind==='word'?{kind:'word',line_id:anchor.lineId,left_id:anchor.leftId,right_id:anchor.rightId}:{kind:'ruby',line_id:anchor.lineId,word_id:anchor.wordId,left_id:anchor.leftId,right_id:anchor.rightId};
}
export function registerKaraokeTools(registry:ToolRegistry) {
  registry.register({name:'get_karaoke_cues',description:'Read karaoke cue IDs, text, anchors, times and validation problems at the saved revision. Filter by line_ids or a 1-based display-line page. include_available_gaps lists unoccupied legal anchor windows for insertion.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
    inputSchema:{project_id:id(),line_ids:z.array(id()).min(1).optional(),start_line:z.number().int().positive().optional(),limit:z.number().int().positive().max(200).optional(),include_available_gaps:z.boolean().default(false)},
    execute:async(args,{client})=>{
      if(args.line_ids&&(args.start_line!==undefined||args.limit!==undefined))invalid('Use line_ids or start_line/limit, not both.');
      const envelope=await client.getDocumentEnvelope(args.project_id),doc=parseProject(envelope.document);
      args.line_ids?.forEach(id=>requireLine(doc,id));
      const ordered=displayLines(doc.lyrics,doc.lineOrder),offset=(args.start_line??1)-1;
      const lines=args.line_ids?ordered.filter(line=>args.line_ids!.includes(line.id)):ordered.slice(offset,offset+(args.limit??50));
      const selected=new Set(lines.map(line=>line.id));
      const cues=doc.karaoke.cues.filter(cue=>selected.has(cue.anchor.lineId));
      const gaps=args.include_available_gaps?lines.flatMap(line=>{
        const anchors:CueAnchor[]=[{kind:'before',lineId:line.id},...gapAnchors(line)];
        return anchors.flatMap(anchor=>{
          const range=anchorRange(doc.lyrics,anchor);if(!range)return [];
          const occupied=cues.filter(cue=>anchorKey(cue.anchor)===anchorKey(anchor));
          if(anchor.kind!=='before'&&occupied.length)return [];
          let cursor=range.beginMs;const free:{beginMs:number;endMs:number}[]=[];
          for(const cue of occupied.sort((a,b)=>a.beginMs-b.beginMs)){
            if(cue.beginMs>cursor)free.push({beginMs:cursor,endMs:Math.min(cue.beginMs,range.endMs)});
            cursor=Math.max(cursor,cue.endMs);
          }
          if(cursor<range.endMs)free.push({beginMs:cursor,endMs:range.endMs});
          return free.filter(part=>part.endMs>part.beginMs).map(part=>({anchor:anchorOut(anchor),begin_ms:part.beginMs,end_ms:part.endMs}));
        });
      }):undefined;
      return {revision:envelope.revision,defaults:doc.karaoke.defaults,groups:doc.karaoke.groups,line_groups:doc.karaoke.lineGroups,line_ids:lines.map(line=>line.id),cues:cues.map(cue=>({cue_id:cue.id,text:cue.text,anchor:anchorOut(cue.anchor),begin_ms:cue.beginMs,end_ms:cue.endMs,problem:cueProblem(doc.lyrics,doc.karaoke,cue)})),...(gaps?{available_gaps:gaps}:{})};
    },
  });
  registry.register({name:'edit_karaoke_cues',description:'Atomically insert/update/delete karaoke cues, remove line cues, or auto-insert by group/threshold using shared desktop rules and If-Match CAS. Anchor fields use line_id/word_id/left_id/right_id. client_ref can be used by later cue operations in the same batch.',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false},
    inputSchema:{...writeSchema(),operations:z.array(z.discriminatedUnion('op',[
      z.object({op:z.literal('insert_cue'),anchor:anchorSchema,text:z.string().min(1).optional(),begin_ms:millis().optional(),end_ms:millis().optional(),client_ref:id().optional()}),
      z.object({op:z.literal('update_cue'),cue_id:id(),text:z.string().min(1).optional(),begin_ms:millis().optional(),end_ms:millis().optional()}),
      z.object({op:z.literal('delete_cue'),cue_id:id()}),
      z.object({op:z.literal('remove_line_cues'),line_ids:z.array(id()).min(1)}),
      z.object({op:z.literal('auto_insert_cues'),group_ids:z.array(id()).min(1).optional(),thresholds:z.object({before_ms:millis().optional(),word_ms:millis().optional(),ruby_ms:millis().optional()}).optional()}),
    ])).min(1)},
    execute:async(args,{client})=>mutateProjectDocument(client,args.project_id,{expectedRevision:args.expected_revision,idempotencyKey:args.idempotency_key},(doc,envelope)=>{
      let state=createProjectEditorState(doc);const refs:Record<string,string>=Object.create(null);
      const apply=(command:KaraokeCommand)=>{state=executeProjectCommand(state,{type:'karaoke',command});};
      args.operations.forEach((op,index)=>withOperationContext(op,index,envelope.revision,()=>{
        if(op.op==='insert_cue'){
          const before=state.present.karaoke.cues;
          apply({kind:'insert',anchor:anchorIn(op.anchor),...(op.text!==undefined?{text:op.text}:{}),...(op.begin_ms!==undefined?{beginMs:op.begin_ms}:{}),...(op.end_ms!==undefined?{endMs:op.end_ms}:{})});
          const created=state.present.karaoke.cues.find(cue=>!before.some(old=>old.id===cue.id))??invalid('The anchor already has a cue.');
          remember(refs,op.client_ref,created.id);
        }else if(op.op==='update_cue'||op.op==='delete_cue'){
          const cue=state.present.karaoke.cues.find(cue=>cue.id===reference(refs,op.cue_id))??invalid('Karaoke cue does not exist.');
          apply(op.op==='delete_cue'?{kind:'remove',id:cue.id}:{kind:'cue',id:cue.id,text:op.text??cue.text,beginMs:op.begin_ms??cue.beginMs,endMs:op.end_ms??cue.endMs});
        }else if(op.op==='remove_line_cues')apply({kind:'remove-lines',lineIds:op.line_ids});
        else {
          const defaults=state.present.karaoke.defaults,thresholds=op.thresholds;
          apply({kind:'auto',groupIds:op.group_ids??state.present.karaoke.groups.map(group=>group.id),thresholds:{beforeMs:thresholds?.before_ms??defaults.beforeMs,wordMs:thresholds?.word_ms??defaults.wordMs,rubyMs:thresholds?.ruby_ms??defaults.rubyMs}});
        }
      }));
      return {nextDoc:state.present,summary:{created_refs:refs,cue_count:state.present.karaoke.cues.length,operations_applied:args.operations.length}};
    }),
  });
}
