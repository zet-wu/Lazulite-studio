import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine, createLyricDocument } from '../../domain/lyric-document';
import { SongPartField } from './SongPartField';
afterEach(cleanup);
it('keeps mixed values read-only, clears selected mains once, returns focus and enables editing',()=>{
 const document=createLyricDocument();document.lines=[{...createLine('','a'),songPart:'Verse'},{...createLine('','b'),songPart:'Chorus'}];
 const apply=vi.fn(()=>true),view=render(<SongPartField document={document} lines={document.lines} apply={apply}/>);
 const input=screen.getByLabelText('歌曲段落');expect(input).toHaveAttribute('readonly');expect(input).toHaveValue('多个值');fireEvent.focus(input);fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'清除所选主行歌曲段落'}));expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenLastCalledWith({type:'set-song-part',lineIds:['a','b'],value:null});expect(input).toHaveFocus();
 document.lines=document.lines.map(line=>({...line,songPart:null}));view.rerender(<SongPartField document={document} lines={document.lines} apply={apply}/>);expect(input).not.toHaveAttribute('readonly');expect(screen.queryByRole('button')).toBeNull();
 fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:' 自由段落 '}});fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);expect(apply).toHaveBeenCalledTimes(1);fireEvent.compositionEnd(input);fireEvent.blur(input);expect(apply).toHaveBeenLastCalledWith({type:'set-song-part',lineIds:['a','b'],value:' 自由段落 '});
});
it('background is read-only, mixed main/background edits only selected mains, whitespace clears',()=>{
 const document=createLyricDocument();document.lines=[{...createLine('','a'),songPart:'Custom'},{...createLine('','bg'),backgroundOf:'a'},createLine('','b')];const apply=vi.fn(()=>true);
 const view=render(<SongPartField document={document} lines={[document.lines[1]]} apply={apply}/>);expect(screen.getByLabelText('歌曲段落')).toHaveAttribute('readonly');expect(screen.getByLabelText('歌曲段落')).toHaveValue('Custom');expect(screen.queryByRole('button')).toBeNull();
 view.rerender(<SongPartField document={document} lines={document.lines.slice(1)} apply={apply}/>);const input=screen.getByLabelText('歌曲段落');fireEvent.change(input,{target:{value:'Other'}});fireEvent.blur(input);expect(apply).toHaveBeenCalledWith({type:'set-song-part',lineIds:['b'],value:'Other'});
 fireEvent.change(input,{target:{value:'  '}});fireEvent.blur(input);expect(apply).toHaveBeenLastCalledWith({type:'set-song-part',lineIds:['b'],value:null});
 fireEvent.change(input,{target:{value:'cancel'}});fireEvent.keyDown(input,{key:'Escape'});fireEvent.blur(input);expect(apply).toHaveBeenCalledTimes(2);
});
