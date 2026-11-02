import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi, afterEach } from 'vitest';
import * as validation from '../adapters/lyric-validation';
import { createLyricDocument, createLine } from '../domain/lyric-document';
import { createProjectEditing } from '../domain/project-editing';
import { createAmllSettings } from '../domain/amll-compatibility';
import { useAutomaticValidation, type ValidationTab } from './useAutomaticValidation';
afterEach(()=>vi.restoreAllMocks());
it('checks only committed inputs, coalesces changes and cancels checks after switching or leaving', async()=>{
 const check=vi.spyOn(validation,'validateLyricsIncrementally').mockResolvedValue([]);
 const initial={doc:{...createLyricDocument(),lines:[createLine('initial')]},editing:createProjectEditing(),amll:createAmllSettings(),tab:'lyrics' as ValidationTab};
 const {result,rerender,unmount}=renderHook(p=>useAutomaticValidation(p.doc,p.editing,p.amll,'p',p.tab),{initialProps:initial});
 await waitFor(()=>expect(result.current.current).toBe(true));expect(check).toHaveBeenCalledTimes(1);
 rerender({...initial}); expect(check).toHaveBeenCalledTimes(1);
 const next={...initial,doc:{...initial.doc,lines:[createLine('next')]}};
 rerender(next);expect(result.current.current).toBe(false);
 rerender({...next,tab:'amll'});await waitFor(()=>expect(result.current.current).toBe(true));
 expect(result.current.result?.amll).toBeDefined();expect(check).toHaveBeenCalledTimes(1);
 rerender({...next,tab:'lyrics'});await waitFor(()=>expect(check).toHaveBeenCalledTimes(2));
 rerender({...next,doc:createLyricDocument()});unmount();await act(()=>new Promise(resolve=>setTimeout(resolve,10)));expect(check).toHaveBeenCalledTimes(2);
});
it('reports execution failures instead of a successful empty report',async()=>{
 vi.spyOn(validation,'validateLyricsIncrementally').mockImplementation(()=>{throw new Error('计算失败样例');});
 const {result}=renderHook(()=>useAutomaticValidation(createDoc,editing,undefined,'p','lyrics'));
 await waitFor(()=>expect(result.current.current).toBe(true));expect(result.current.result?.error).toEqual({key:'error.unexpected',values:{diagnostic:'计算失败样例'}});expect(result.current.result?.issues).toBeUndefined();
});
const createDoc={...createLyricDocument(),lines:[createLine('test')]},editing=createProjectEditing();
it('rejects delayed results from a previous project and tab even if a checker finishes after cancellation',async()=>{
 let finish!:(issues:[])=>void;
 const check=vi.spyOn(validation,'validateLyricsIncrementally').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue([]);
 const initial={id:'old',tab:'lyrics' as ValidationTab};
 const {result,rerender}=renderHook(p=>useAutomaticValidation(createDoc,editing,undefined,p.id,p.tab),{initialProps:initial});
 await waitFor(()=>expect(check).toHaveBeenCalledTimes(1));
 rerender({id:'new',tab:'amll'});await waitFor(()=>expect(result.current.current).toBe(true));
 await act(async()=>finish([]));expect(result.current.result?.input.projectId).toBe('new');expect(result.current.result?.amll).toBeDefined();
});

it('clears a delayed lyric result after deleting the last line and retains independent audio range issues',async()=>{
 let finish!:(issues:[])=>void;
 const check=vi.spyOn(validation,'validateLyricsIncrementally').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue([]);
 const acoustics={analysisId:null,segments:[{id:'segment',beginMs:0,endMs:2000}]};
 const {result,rerender}=renderHook(doc=>useAutomaticValidation(doc,editing,undefined,'p','lyrics',acoustics,'asset',1000),{initialProps:createDoc});
 await waitFor(()=>expect(check).toHaveBeenCalledTimes(1));
 rerender({...createLyricDocument(),lines:[]});await waitFor(()=>expect(result.current.current).toBe(true));
 expect(check).toHaveBeenCalledTimes(1);expect(result.current.result?.issues).toEqual([expect.objectContaining({code:'audio-range',segmentId:'segment'})]);
 await act(async()=>finish([]));expect(result.current.result?.input.document.lines).toHaveLength(0);
 rerender({...createLyricDocument(),lines:[createLine('')]});await waitFor(()=>expect(check).toHaveBeenCalledTimes(2));
});
