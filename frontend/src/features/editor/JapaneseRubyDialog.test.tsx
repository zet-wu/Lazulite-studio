import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { JapaneseRubyDialog } from './JapaneseRubyDialog';
import { analyzeReadings } from '../../adapters/http/reading';
vi.mock('../../adapters/http/reading',()=>({analyzeReadings:vi.fn()}));
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('rejects stale source and aborts late response on close',async()=>{
 let resolve!:(value:{ranges:[]})=>void;vi.mocked(analyzeReadings).mockImplementation(()=>new Promise(r=>{resolve=r;}));const source=createLyricDocument('今日'),apply=vi.fn(()=>true);
 const props={lineIds:[source.lines[0].id],apply,close:vi.fn()};const view=render(<JapaneseRubyDialog {...props} document={source}/>);
 await waitFor(()=>expect(analyzeReadings).toHaveBeenCalled());const signal=vi.mocked(analyzeReadings).mock.calls[0][1];view.rerender(<JapaneseRubyDialog {...props} document={{...source}}/>);expect(screen.getByRole('alert')).toHaveTextContent('源文档已变化');expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();view.unmount();expect(signal.aborted).toBe(true);await act(async()=>resolve({ranges:[]}));expect(apply).not.toHaveBeenCalled();
});
it('preserves manual edits when a pending/retried analysis changes token boundaries',async()=>{
 let resolve!:(value:any)=>void;vi.mocked(analyzeReadings).mockImplementation(()=>new Promise(r=>{resolve=r;}));const source=createLyricDocument('今日魂');render(<JapaneseRubyDialog document={source} lineIds={[source.lines[0].id]} apply={()=>true} close={()=>{}}/>);
 await waitFor(()=>expect(analyzeReadings).toHaveBeenCalled());fireEvent.change(screen.getByLabelText('今日魂完整读音'),{target:{value:'ていねい'}});
 await act(async()=>resolve({ranges:[{line_id:source.lines[0].id,base_start:0,base_end:2,base:'今日',reading:'きょう'},{line_id:source.lines[0].id,base_start:2,base_end:3,base:'魂',reading:'たましい'}]}));
 await waitFor(()=>expect(screen.getByLabelText('今日魂完整读音')).toHaveValue('ていねい'));
});
it('switching regenerates from the opening snapshot and discards edits, including existing ruby',async()=>{
 const source=createLyricDocument('今日魂');const line=source.lines[0];
 line.words=[{...line.words[0],text:'今'},{...line.words[0],id:'day',text:'日'},{...line.words[0],id:'soul',text:'魂',rubyUnits:[{id:'ruby',reading:'たましい',beginMs:null,endMs:null}]}];
 vi.mocked(analyzeReadings).mockResolvedValue({ranges:[{line_id:line.id,base_start:0,base_end:2,base:'今日',reading:'きょう'}]});
 render(<JapaneseRubyDialog document={source} lineIds={[line.id]} apply={()=>true} close={()=>{}}/>);
 await waitFor(()=>expect(screen.queryByText('正在分析日文正文…')).toBeNull());
 const toggle=screen.getByRole('checkbox',{name:'自动合并多汉字词'});expect(toggle).not.toBeChecked();
 fireEvent.change(screen.getByLabelText('魂完整读音'),{target:{value:'変更'}});
 fireEvent.change(screen.getByLabelText('今完整读音'),{target:{value:'いま'}});
 fireEvent.click(toggle);
 expect(await screen.findByLabelText('今日完整读音')).toHaveValue('きょう');expect(screen.getByText('将合并')).toBeVisible();
 expect(screen.getByLabelText('魂完整读音')).toHaveValue('たましい');
 fireEvent.change(screen.getByLabelText('今日完整读音'),{target:{value:'こんにち'}});fireEvent.click(toggle);
 await waitFor(()=>expect(screen.getByLabelText('今完整读音')).toHaveValue(''));
 expect(source.lines[0].words[2].rubyUnits[0].reading).toBe('たましい');
});
it('ignores superseded generation, disables switching during IME, and never applies failed-mode results',async()=>{
 const source=createLyricDocument('今日'),line=source.lines[0];const apply=vi.fn(()=>true);
 const resolves:Array<(value:any)=>void>=[];
 vi.mocked(analyzeReadings).mockImplementation(()=>new Promise(resolve=>resolves.push(resolve)));
 render(<JapaneseRubyDialog document={source} lineIds={[line.id]} apply={apply} close={()=>{}}/>);
 await waitFor(()=>expect(resolves).toHaveLength(1));
 const input=screen.getByLabelText('今日完整读音'),toggle=screen.getByRole('checkbox',{name:'自动合并多汉字词'});
 fireEvent.compositionStart(input);expect(toggle).toBeDisabled();fireEvent.compositionEnd(input);
 fireEvent.click(toggle);await waitFor(()=>expect(resolves).toHaveLength(2));
 expect(vi.mocked(analyzeReadings).mock.calls[0][1].aborted).toBe(true);
 await act(async()=>resolves[0]({ranges:[{line_id:line.id,base_start:0,base_end:2,base:'今日',reading:'古い'}]}));
 expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();expect(screen.getByLabelText('今日完整读音')).toHaveValue('');
 await act(async()=>resolves[1]({ranges:[]}));
 expect(apply).not.toHaveBeenCalled();
});
it('a failed mode switch cannot reuse previous results and retry protects new manual input',async()=>{
 const source=createLyricDocument('今日'),line=source.lines[0];
 vi.mocked(analyzeReadings).mockResolvedValueOnce({ranges:[{line_id:line.id,base_start:0,base_end:2,base:'今日',reading:'きょう'}]}).mockRejectedValueOnce(new Error('新模式分析失败')).mockResolvedValueOnce({ranges:[{line_id:line.id,base_start:0,base_end:2,base:'今日',reading:'きょう'}]});
 render(<JapaneseRubyDialog document={source} lineIds={[line.id]} apply={()=>true} close={()=>{}}/>);
 await waitFor(()=>expect(screen.getByLabelText('今日完整读音')).toHaveValue('きょう'));
 fireEvent.change(screen.getByLabelText('今日完整读音'),{target:{value:'旧修改'}});fireEvent.click(screen.getByRole('checkbox'));
 expect(await screen.findByRole('alert')).toHaveTextContent('新模式分析失败');expect(screen.getByLabelText('今日完整读音')).toHaveValue('');expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('今日完整读音'),{target:{value:'こんにち'}});fireEvent.click(screen.getByRole('button',{name:'重试读取日文读音'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'应用'})).toBeEnabled());expect(screen.getByLabelText('今日完整读音')).toHaveValue('こんにち');
});
it('retains manual application after a reading service failure',async()=>{
 const source=createLyricDocument('今日'),apply=vi.fn(()=>true),close=vi.fn();vi.mocked(analyzeReadings).mockRejectedValue(new Error('服务不可用'));
 render(<JapaneseRubyDialog document={source} lineIds={[source.lines[0].id]} apply={apply} close={close}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('服务不可用');fireEvent.change(screen.getByLabelText('今日完整读音'),{target:{value:'きょう'}});
 expect(screen.getByRole('button',{name:'应用'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'应用'}));
 expect(apply).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(source.lines[0].words[0].rubyUnits).toHaveLength(0);
});
