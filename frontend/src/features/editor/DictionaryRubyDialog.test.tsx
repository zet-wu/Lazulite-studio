import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DictionaryRubyDialog } from './DictionaryRubyDialog';
import { analyzeDictionary, listDictionaries } from '../../adapters/http/dictionaries';
import { createLyricDocument } from '../../domain/lyric-document';

vi.mock('../../adapters/http/dictionaries',()=>({listDictionaries:vi.fn(),analyzeDictionary:vi.fn()}));
beforeEach(()=>{
  localStorage.clear();
  vi.mocked(listDictionaries).mockResolvedValue({errors:[],dictionaries:['a','b'].map(id=>({id,instance:id,manifest:{name:id,version:'1',region:id},sources:{},error:null}))});
  vi.mocked(analyzeDictionary).mockReset();
});
it('aborts old selections, preserves fixed unit edits on retry, and blocks stale source',async()=>{
  const source=createLyricDocument('重庆'),lineId=source.lines[0].id,apply=vi.fn();
  let resolveA!:(r:any)=>void;
  vi.mocked(analyzeDictionary).mockImplementation((id)=>id==='a'?new Promise(r=>{resolveA=r;}):Promise.resolve({instance:'b',version:'1',ranges:[{lineId,start:0,end:2,base:'重庆',status:'known',units:['chóng','qìng']}]}));
  const view=render(<DictionaryRubyDialog document={source} lineIds={[lineId]} apply={apply} close={()=>{}}/>);
  await screen.findByRole('option',{name:'a · 1 · a'});
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'a'}});
  await waitFor(()=>expect(analyzeDictionary).toHaveBeenCalledTimes(1));
  const signal=vi.mocked(analyzeDictionary).mock.calls[0][3];
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'b'}});
  await screen.findByLabelText('重庆读音 1');
  expect(signal.aborted).toBe(true);
  await act(async()=>resolveA({instance:'a',version:'1',ranges:[]}));
  fireEvent.change(screen.getByLabelText('重庆读音 1'),{target:{value:'several syllables'}});
  fireEvent.click(screen.getByRole('button',{name:'重新生成词典注音'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'应用'})).toBeEnabled());
  expect(screen.getByLabelText('重庆读音 1')).toHaveValue('several syllables');
  expect(screen.getByLabelText('重庆读音 2')).toHaveValue('qìng');
  view.rerender(<DictionaryRubyDialog document={{...source}} lineIds={[lineId]} apply={apply} close={()=>{}}/>);
  expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});
