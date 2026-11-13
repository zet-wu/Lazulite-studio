import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { SingerDialog } from './SingerDialog';
import { TableField } from './ManagementTable';
afterEach(cleanup);
it.each([[[], 'v1'], [['v1','v3'],'v2'], [['v2','custom'],'v1'], [['v01','V1'],'v1']])('prefills the first free exact ID for %j', (ids, expected) => {
 const document=createLyricDocument();document.agents=(ids as string[]).map(id=>({id,type:'person',name:null}));
 const apply=vi.fn(()=>true);render(<SingerDialog document={document} apply={apply} close={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'添加歌手'}));
 const field=screen.getByLabelText('歌手 ID');expect(field).toHaveValue(expected);
 fireEvent.keyDown(field,{key:'Enter'});expect(apply).toHaveBeenCalledTimes(1);
 expect(apply.mock.calls[0]).toEqual([{type:'set-agents',agents:[...document.agents,{id:expected,type:'person',name:null}]}]);
});
it('commits an unchanged initial value once, respects composition and leaves saved fields quiet',()=>{
 const commit=vi.fn(()=>true);const view=render(<TableField value="v1" label="draft" commitInitial commit={commit}/>);
 const field=screen.getByLabelText('draft');fireEvent.compositionStart(field);fireEvent.keyDown(field,{key:'Enter'});expect(commit).not.toHaveBeenCalled();fireEvent.compositionEnd(field);
 fireEvent.keyDown(field,{key:'Enter'});fireEvent.blur(field);expect(commit).toHaveBeenCalledTimes(1);
 view.unmount();render(<TableField value="v1" label="saved" commit={commit}/>);fireEvent.blur(screen.getByLabelText('saved'));expect(commit).toHaveBeenCalledTimes(1);
});
it('cancels a default draft with Escape without adding a singer',()=>{
 const apply=vi.fn(()=>true);render(<SingerDialog document={createLyricDocument()} apply={apply} close={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'添加歌手'}));fireEvent.keyDown(screen.getByLabelText('歌手 ID'),{key:'Escape'});expect(apply).not.toHaveBeenCalled();expect(screen.queryByLabelText('歌手 ID')).toBeNull();
});
