import {afterEach,expect,it} from 'vitest';
import {alignmentDefaults,resolveDefaultModel} from '../src/adapters/studio-preferences';
afterEach(()=>localStorage.clear());
it('takes independent task snapshots and resolves model names after process or root changes',()=>{
 localStorage.setItem('studio:alignment-defaults',JSON.stringify({gap_threshold_ms:123,use_hints:true,latin_normalize:false}));
 localStorage.setItem('studio:convert-particles','false');
 const first=alignmentDefaults();first.use_hints=false;first.gap_threshold_ms=9;
 expect(alignmentDefaults()).toMatchObject({gap_threshold_ms:123,use_hints:true,latin_normalize:false,convert_particles:false});
 localStorage.setItem('studio:alignment-model',JSON.stringify({name:'model-a',type:'MMS_FA'}));
 const models=[{name:'model-a',type:'MMS_FA',status:'ready',id:'new-process-id'}];
 expect(resolveDefaultModel(models)).toEqual({id:'new-process-id',missing:false});
 expect(resolveDefaultModel([{...models[0],type:'other'}])).toEqual({id:'',missing:true});
 expect(resolveDefaultModel([{...models[0],status:'invalid'}])).toEqual({id:'',missing:true});
 expect(resolveDefaultModel([])).toEqual({id:'',missing:true});
 expect(localStorage.getItem('studio:alignment-model')).toContain('model-a');
});
