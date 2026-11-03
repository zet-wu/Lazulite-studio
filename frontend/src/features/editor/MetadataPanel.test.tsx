import { useState } from 'react';
import { act, waitFor, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MetadataPanel } from './MetadataPanel';
import { DialogEditingLocked } from './SettingsDialog';
import { createLyricDocument } from '../../domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../../../tests/helpers/project-history';
import type { LyricCommand } from '../../domain/lyric-commands';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fixture(metadata: Record<string,string[]> = {}) {
 let state=createLyricEditorState({...createLyricDocument('歌'),metadata});
 const apply=vi.fn((command:LyricCommand)=>{state=executeLyricCommand(state,command);refresh();return true;});
 let asset='audio',locked=false;
 let refresh=()=>{};
 const Harness=()=>{const [,setRevision]=useState(0);refresh=()=>setRevision(n=>n+1);return <DialogEditingLocked.Provider value={locked}><MetadataPanel document={state.present} apply={apply} projectId="project" sourceAssetId={asset}/></DialogEditingLocked.Provider>;};
 const view=render(<Harness/>);const draw=()=>view.rerender(<Harness/>);
 let resolve!:(response:Response)=>void;
 const fetch=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal('fetch',fetch);
 return {apply,fetch,view, get state(){return state;},draw, setAsset:(value:string)=>{asset=value;draw();},lock:()=>{locked=true;draw();}, read:()=>fireEvent.click(screen.getByRole('button',{name:/使用歌曲元数据|正在读取/})),finish:async(conditions={title:'源标题',artist:'A / B, C & D',album:'源专辑'},status=200)=>{await act(async()=>resolve({ok:status===200,json:async()=>({asset_id:'audio',conditions})} as Response));if(view.container.isConnected && view.container.childElementCount)await waitFor(()=>expect(screen.getByRole('button',{name:'使用歌曲元数据'})).toHaveAttribute('aria-busy','false'));}};
}
it('fills only empty lists atomically and preserves lists, arbitrary keys, undo and redo',async()=>{
 const f=fixture({title:['','已有'],album:['  '],custom:['keep']});const before=f.state.present;f.read();f.read();expect(f.fetch).toHaveBeenCalledTimes(1);await f.finish();
 expect(f.apply).toHaveBeenCalledTimes(1);expect(f.state.present.metadata).toEqual({title:['','已有'],artist:['A / B, C & D'],album:['源专辑'],custom:['keep']});expect(f.state.past).toHaveLength(1);
 const undone=undoLyricCommand(f.state);expect(undone.present).toEqual(before);expect(redoLyricCommand(undone).present).toEqual(f.state.present);
 f.read();await f.finish();expect(f.apply).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('没有需要填入');
});
it('uses a blur-committed value from while the request was pending and protects a composition draft',async()=>{
 const f=fixture({title:[' ']});f.read();const input=screen.getByRole('textbox',{name:'元数据 title 值 1'});fireEvent.change(input,{target:{value:'手写'}});fireEvent.blur(input);await f.finish();expect(f.state.present.metadata.title).toEqual(['手写']);
 f.read();fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'组合'}});fireEvent.blur(input);await f.finish();expect(f.state.present.metadata.title).toEqual(['手写']);expect(screen.getByRole('status')).toHaveTextContent('请先完成');
});
it('ignores closed, replaced and locked requests and reports failure without changing metadata',async()=>{
 const f=fixture();f.read();f.setAsset('replacement');await f.finish();expect(f.apply).not.toHaveBeenCalled();f.setAsset('audio');f.read();await f.finish(undefined,422);expect(screen.getByRole('status')).toHaveTextContent('读取失败');expect(f.apply).not.toHaveBeenCalled();
 f.read();f.lock();await f.finish();expect(f.apply).not.toHaveBeenCalled();f.view.unmount();
 const other=fixture();other.read();other.view.unmount();await other.finish();expect(other.apply).not.toHaveBeenCalled();
});
it('does not create history for empty tags or overwrite an uncommitted new row',async()=>{
 const f=fixture();f.read();await f.finish({title:' ',artist:'',album:''});expect(f.apply).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('未读到');
 fireEvent.click(screen.getByRole('button',{name:'新增元数据键'}));f.read();expect(f.fetch).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('请先完成');
});
