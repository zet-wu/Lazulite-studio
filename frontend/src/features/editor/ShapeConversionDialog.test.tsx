import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShapeConversionDialog } from './ShapeConversionDialog';
import { analyzeShapes } from '../../adapters/http/shapes';
import { createLyricDocument } from '../../domain/lyric-document';
import type { ShapeRow } from '../../domain/shape-conversion';
vi.mock('../../adapters/http/shapes',()=>({analyzeShapes:vi.fn()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
beforeEach(()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  vi.mocked(analyzeShapes).mockReset();
});
it('isolates target changes and late responses, restores Escape state, preserves edits on retry and blocks stale snapshots',async()=>{
  const source=createLyricDocument('发'),line=source.lines[0],apply=vi.fn(),close=vi.fn();
  const rows:ShapeRow[]=[{id:line.id,cells:[{key:'cell',original:'发',value:'發',status:'ambiguous',edited:false,editable:true,wordId:line.words[0].id,start:0,end:1}]}];
  let late!:(rows:ShapeRow[])=>void;
  vi.mocked(analyzeShapes).mockImplementationOnce(()=>new Promise(resolve=>late=resolve)).mockResolvedValue(rows);
  const view=render(<ShapeConversionDialog document={source} lineIds={[line.id]} apply={apply} close={close}/>);
  await waitFor(()=>expect(analyzeShapes).toHaveBeenCalledTimes(1));
  const signal=vi.mocked(analyzeShapes).mock.calls[0][3];
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'taiwan'}});
  const input=await screen.findByLabelText('发的目标字');expect(signal.aborted).toBe(true);
  await act(async()=>late([]));expect(input).toHaveValue('發');
  fireEvent.focus(input);
  fireEvent.change(input,{target:{value:'髮'}});
  fireEvent.keyDown(input,{key:'Escape'});expect(input).toHaveValue('發');expect(close).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'多字'}});fireEvent.keyDown(input,{key:'Escape',isComposing:true});expect(input).toHaveValue('多字');
  expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();fireEvent.compositionEnd(input);expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();
  fireEvent.change(input,{target:{value:''}});expect(screen.getByRole('button',{name:'应用'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'重新分析字形'}));await waitFor(()=>expect(screen.getByRole('button',{name:'应用'})).toBeEnabled());expect(input).toHaveValue('');
  view.rerender(<ShapeConversionDialog document={{...source}} lineIds={[line.id]} apply={apply} close={close}/>);expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();
});
it('an overall service failure cannot apply the retained preview',async()=>{
  const source=createLyricDocument('发');vi.mocked(analyzeShapes).mockRejectedValue(new Error('资源缺失'));
  render(<ShapeConversionDialog document={source} lineIds={[source.lines[0].id]} apply={vi.fn()} close={()=>{}}/>);
  await screen.findByText(/资源缺失/);expect(screen.getByRole('button',{name:'应用'})).toBeDisabled();expect(screen.getByRole('button',{name:'重新分析字形'})).toBeEnabled();
});
