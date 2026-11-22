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
it('active expansion and height save on commit, retain invalid drafts and restore with Escape',async()=>{
 let revision=1,fail=false;const values:Record<string,string>={};
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  if(init?.method==='PATCH'){if(fail)return new Response('',{status:503});Object.assign(values,JSON.parse(init.body).changes);revision++;}
  return Response.json({version:1,revision,library_id:'b'.repeat(32),values});
 }));await loadPreferences();
 const mount=()=>render(<StudioSettings initial="timeline" close={()=>{}}/>);const view=mount();
 expect(screen.getByRole('combobox',{name:'活动行自动展开显示'})).toHaveValue('follow');
 fireEvent.change(screen.getByRole('combobox',{name:'活动行自动展开显示'}),{target:{value:'always'}});
 const height=screen.getByRole('spinbutton',{name:'声谱图高度'});
 expect(height).toHaveValue(72);
 fireEvent.change(height,{target:{value:'35'}});fireEvent.blur(height);
 expect(height).toHaveValue(35);expect(height).toHaveAttribute('aria-invalid','true');expect(values['studio:spectrum-height']).toBeUndefined();
 fireEvent.keyDown(height,{key:'Escape'});expect(height).toHaveValue(72);expect(height).toHaveAttribute('aria-invalid','false');
 fireEvent.change(height,{target:{value:'216'}});fireEvent.keyDown(height,{key:'Enter'});
 await waitFor(()=>expect(values['studio:spectrum-height']).toBe('216'));
 view.unmount();mount();expect(screen.getByRole('spinbutton',{name:'声谱图高度'})).toHaveValue(216);expect(screen.getByRole('combobox',{name:'活动行自动展开显示'})).toHaveValue('always');
 fail=true;const reopenedHeight=screen.getByRole('spinbutton',{name:'声谱图高度'});fireEvent.change(reopenedHeight,{target:{value:'36'}});fireEvent.keyDown(reopenedHeight,{key:'Enter'});await waitFor(()=>expect(screen.getByRole('alert')).toBeVisible());expect(reopenedHeight).toHaveValue(216);
});
