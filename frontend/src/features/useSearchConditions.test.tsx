import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSearchConditions } from './useSearchConditions';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('fills all fields in one save, preserves conditions on failure and discards responses after edits or source changes',async()=>{
 let resolve!:(value:Response)=>void;const saved:string[]=[];
 const original={title:'手填',artist:'艺术家',album:'专辑'};
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit={})=>{
   if(url.endsWith('source-metadata'))return new Promise<Response>(done=>resolve=done);
   if(options.method==='PUT'){saved.push(options.body as string);return Promise.resolve(Response.json(JSON.parse(options.body as string)));}
   return Promise.resolve(Response.json(original));
 }));
 const {result,rerender}=renderHook(({asset})=>useSearchConditions('project',asset),{initialProps:{asset:'one'}});await waitFor(()=>expect(result.current.ready).toBe(true));
 let request:Promise<void>;act(()=>{request=result.current.fillMetadata();});expect(result.current.readingMetadata).toBe(true);
 await act(async()=>{resolve(Response.json({asset_id:'one',conditions:{title:'源文件',artist:'',album:''}}));await request;});expect(result.current.values).toEqual({title:'源文件',artist:'',album:''});expect(saved).toHaveLength(1);
 act(()=>{request=result.current.fillMetadata();});act(()=>result.current.change('title','新输入'));
 await act(async()=>{resolve(Response.json({asset_id:'one',conditions:original}));await request;});expect(result.current.values.title).toBe('新输入');
 act(()=>{request=result.current.fillMetadata();});rerender({asset:'two'});
 await act(async()=>{resolve(Response.json({asset_id:'one',conditions:original}));await request;});expect(result.current.values.title).toBe('新输入');
 act(()=>{request=result.current.fillMetadata();});await act(async()=>{resolve(new Response('',{status:422}));await request;});expect(result.current.metadataError).toContain('读取失败');expect(result.current.values.title).toBe('新输入');
});
