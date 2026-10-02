import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { usePreference } from '../src/features/editor/use-preference';
it('persists choices immediately, isolates scopes and rejects corrupt storage',()=>{
 localStorage.clear();
 const valid=(v:unknown):v is string=>v==='lrc'||v==='ttml';
 const {result,rerender,unmount}=renderHook(({scope})=>usePreference(scope,'ttml',valid),{initialProps:{scope:'download:one'}});
 act(()=>result.current[1]('lrc'));expect(JSON.parse(localStorage.getItem('download:one')!)).toBe('lrc');
 rerender({scope:'packaging:one'});expect(result.current[0]).toBe('ttml');
 rerender({scope:'download:two'});expect(result.current[0]).toBe('ttml');
 rerender({scope:'download:one'});expect(result.current[0]).toBe('lrc');unmount();
 expect(renderHook(()=>usePreference('download:one','ttml',valid)).result.current[0]).toBe('lrc');
 localStorage.setItem('broken','{');expect(renderHook(()=>usePreference('broken','ttml',valid)).result.current[0]).toBe('ttml');
});
