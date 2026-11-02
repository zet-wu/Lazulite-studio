import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {i18n} from '../src/i18n';
import {InlineDraft} from '../src/features/editor/InlineAdd';
afterEach(async()=>{cleanup();await i18n.changeLanguage('zh-Hans');});
it('keeps the input node, draft, focus, selection and composition during a language switch',async()=>{
 const commit=vi.fn(()=>true),close=vi.fn();render(<InlineDraft label="lyric input" commit={commit} close={close}/>);
 const input=screen.getByRole('textbox') as HTMLInputElement;
 fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'未定の歌詞'}});input.setSelectionRange(2,4);
 await act(async()=>{await i18n.changeLanguage('en');});
 expect(screen.getByRole('textbox')).toBe(input);expect(input).toHaveFocus();expect(input.value).toBe('未定の歌詞');
 expect([input.selectionStart,input.selectionEnd]).toEqual([2,4]);
 fireEvent.keyDown(input,{key:'Enter'});expect(commit).not.toHaveBeenCalled();
 fireEvent.compositionEnd(input);fireEvent.keyDown(input,{key:'Enter'});expect(commit).toHaveBeenCalledWith('未定の歌詞');expect(close).toHaveBeenCalledOnce();
});
it('renders an already visible failed-edit message in the new language without discarding the draft',async()=>{
 render(<InlineDraft label="lyric input" commit={()=>false} close={vi.fn()}/>);
 const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'lyrics'}});fireEvent.keyDown(input,{key:'Enter'});
 expect(screen.getByRole('alert')).toHaveTextContent('输入已保留');
 await act(async()=>{await i18n.changeLanguage('en');});
 expect(screen.getByRole('alert')).toHaveTextContent('Your input is preserved');expect(input).toHaveValue('lyrics');
});
