import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { JapaneseRubyDialog } from './JapaneseRubyDialog';
import { analyzeReadings } from '../../adapters/http/reading';
vi.mock('../../adapters/http/reading',()=>({analyzeReadings:vi.fn()}));
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
