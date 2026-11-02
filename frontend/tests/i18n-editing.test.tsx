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

it('translates existing audio-range issues while retaining their object identity and location',async()=>{
 HTMLElement.prototype.scrollIntoView=vi.fn();
 const {OutputIssues}=await import('../src/features/OutputIssues');
 const {audioRangeIssues}=await import('../src/adapters/audio-validation');
 const {createLyricDocument}=await import('../src/domain/lyric-document');
 const document=createLyricDocument('原文');document.lines[0].beginMs=100;document.lines[0].endMs=1500;
 const issues=audioRangeIssues(document,undefined,'source',1000),locate=vi.fn();
 render(<OutputIssues issues={issues} highlighted={issues} document={document} locate={locate}/>);
 const original=screen.getByRole('button',{name:/结束时间 1500 ms/});original.focus();
 expect(original).toBeVisible();
 await act(async()=>{await i18n.changeLanguage('en');});
 const button=screen.getByRole('button',{name:/End time 1500 ms exceeds the reference audio duration of 1000 ms by 500 ms/});
 expect(button).toBe(original);expect(button).toHaveFocus();
 fireEvent.click(button);expect(locate).toHaveBeenCalledWith(issues[0]);
 expect(issues[0].sourceAssetId).toBe('source');expect(document.lines[0].endMs).toBe(1500);
});
