import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {browserLanguage,registeredLanguage} from '../src/i18n/language';
import {i18n,chooseLanguage,initializeLanguage} from '../src/i18n';
import {loadPreferences} from '../src/adapters/preferences';
import {MessageBar,type Notice} from '../src/shared/MessageBar';
import {message} from '../src/domain/messages';
afterEach(async()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();await i18n.changeLanguage('zh-Hans');});
it('matches ordered preferences, explicit scripts and regional Chinese variants',()=>{
 expect(browserLanguage(['fr','zh-Hant-CN','en'])).toBe('zh-Hant');
 expect(browserLanguage(['zh-Hans-TW'])).toBe('zh-Hans');
 expect(browserLanguage(['zh-HK'])).toBe('zh-Hant');
 expect(browserLanguage(['zh-MO'])).toBe('zh-Hant');
 expect(browserLanguage(['en-GB','zh-TW'])).toBe('en');
 expect(browserLanguage(['zh-SG'])).toBe('zh-Hans');
 expect(browserLanguage(['ja','fr'])).toBe('zh-Hans');
 expect(registeredLanguage('system')).toBe('zh-Hans');
});
it('translates a visible semantic notice without restarting its lifetime or reopening a dismissed event',async()=>{
 vi.useFakeTimers();const notice:Notice={text:message('menu.saved'),role:'status',timeout:4000,origin:null};
 const view=render(<MessageBar notice={notice}/>);
 expect(screen.getByRole('status')).toHaveTextContent('已保存');
 act(()=>vi.advanceTimersByTime(2500));
 await act(async()=>{await i18n.changeLanguage('en');});
 expect(screen.getByRole('status')).toHaveTextContent('Saved');
 act(()=>vi.advanceTimersByTime(1500));expect(screen.queryByRole('status')).toBeNull();
 await act(async()=>{await i18n.changeLanguage('zh-Hant');});view.rerender(<MessageBar notice={notice}/>);
 expect(screen.queryByRole('status')).toBeNull();
});
it('initialization honors a concurrent winner and explicit failures restore the confirmed language',async()=>{
 const base={version:1,revision:0,library_id:'a'.repeat(32),values:{} as Record<string,string>};
 let saved=base,initial=true,fail=false;
 vi.stubGlobal('fetch',vi.fn(async(_url,options?:RequestInit)=>{
  if(options?.method==='PATCH') {
   if(fail)return new Response('{}',{status:503});
   if(initial){initial=false;saved={...base,revision:1,values:{'studio:ui-language':'zh-Hant'}};return new Response('{}',{status:409});}
   saved={...saved,revision:saved.revision+1,values:{...saved.values,...JSON.parse(options.body as string).changes}};
  }
  return new Response(JSON.stringify(saved));
 }));
 await loadPreferences();await initializeLanguage();expect(i18n.language).toBe('zh-Hant');
 await chooseLanguage('en');expect(i18n.language).toBe('en');
 fail=true;await expect(chooseLanguage('zh-Hans')).rejects.toThrow();expect(i18n.language).toBe('en');
 expect(localStorage.getItem('studio:ui-language')).toBeNull();
});
