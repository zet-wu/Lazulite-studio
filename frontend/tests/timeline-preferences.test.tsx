import {act,renderHook,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useTimelineVisibility,useStagingIgnoredCharacters} from '../src/adapters/timeline-preferences';
import {loadPreferences} from '../src/adapters/preferences';
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
it('shares actual visibility and literal characters between independently mounted consumers and remounts',()=>{
 const first=renderHook(()=>[useTimelineVisibility(),useStagingIgnoredCharacters()] as const);
 const second=renderHook(()=>[useTimelineVisibility(),useStagingIgnoredCharacters()] as const);
 expect(first.result.current[0][0]).toMatchObject({spectrum:false,staging:true,word:true});
 act(()=>first.result.current[0][1]('staging',false));
 expect(second.result.current[0][0]).toMatchObject({staging:false,word:true});
 act(()=>second.result.current[0][1]('spectrum',true));
 expect(first.result.current[0][0].spectrum).toBe(true);
 act(()=>first.result.current[1][1]('  😀\t'));
 expect(second.result.current[1][0]).toBe('  😀\t');
 first.unmount();second.unmount();
 const reopened=renderHook(()=>[useTimelineVisibility(),useStagingIgnoredCharacters()] as const);
 expect(reopened.result.current[0][0]).toMatchObject({staging:false,spectrum:true});
 expect(reopened.result.current[1][0]).toBe('  😀\t');
 act(()=>reopened.result.current[1][1](''));expect(reopened.result.current[1][0]).toBe('');
});
it('broadcasts a portable preference failure and rolls back both mounted consumers',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url,options?:RequestInit)=>options?.method==='PATCH'?new Response('{}',{status:503}):Response.json({version:1,revision:0,library_id:'a'.repeat(32),values:{}})));
 await loadPreferences();
 const first=renderHook(()=>useTimelineVisibility()),second=renderHook(()=>useTimelineVisibility());
 const report=vi.fn();window.addEventListener('studio-preference-error',report);
 try{
  act(()=>first.result.current[1]('word',false));expect(second.result.current[0].word).toBe(false);
  await waitFor(()=>expect(report).toHaveBeenCalledTimes(1));
  expect(first.result.current[0].word).toBe(true);expect(second.result.current[0].word).toBe(true);
 }finally{window.removeEventListener('studio-preference-error',report);}
});
