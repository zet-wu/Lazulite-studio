import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {StudioSettings} from './StudioSettings';
import {loadPreferences} from '../../adapters/preferences';
vi.mock('../AlignmentModelsDialog',()=>({AlignmentModelsDialog:()=>null}));
vi.mock('../DeviceSettings',()=>({DeviceSettings:()=>null}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('wheel preference saves immediately, survives reopen and rolls back with visible failure',async()=>{
 let revision=1,fail=false;const values:Record<string,string>={};
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  if(init?.method==='PATCH'){if(fail)return new Response('',{status:500});Object.assign(values,JSON.parse(init.body).changes);revision++;}
  return Response.json({version:1,revision,library_id:'a'.repeat(32),values});
 }));await loadPreferences();
 const mount=()=>render(<StudioSettings initial="timeline" close={()=>{}}/>);const view=mount();
 const toggle=screen.getByRole('switch',{name:'交换滚轮操作'});expect(toggle).not.toBeChecked();fireEvent.click(toggle);expect(toggle).toBeChecked();await waitFor(()=>expect(values['studio:timeline-swap-wheel']).toBe('true'));
 view.unmount();mount();expect(screen.getByRole('switch',{name:'交换滚轮操作'})).toBeChecked();fail=true;fireEvent.click(screen.getByRole('switch',{name:'交换滚轮操作'}));await waitFor(()=>expect(screen.getByRole('alert')).toBeVisible());expect(screen.getByRole('switch',{name:'交换滚轮操作'})).toBeChecked();
});
