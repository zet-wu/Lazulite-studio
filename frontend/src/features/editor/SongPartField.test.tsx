import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine, createLyricDocument } from '../../domain/lyric-document';
import { SongPartField } from './SongPartField';
afterEach(cleanup);
it('keeps mixed values on focus/blur, waits for IME, commits once and supports explicit clear',()=>{
 const document=createLyricDocument();document.lines=[{...createLine('','a'),songPart:'Verse'},{...createLine('','b'),songPart:'Chorus'}];
 const apply=vi.fn(()=>true);render(<SongPartField document={document} lines={document.lines} apply={apply}/>);
 const input=screen.getByLabelText('歌曲段落');fireEvent.focus(input);fireEvent.blur(input);expect(apply).not.toHaveBeenCalled();expect(input).toHaveAttribute('placeholder','多个值');
 fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'自由段落'}});fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);expect(apply).not.toHaveBeenCalled();fireEvent.compositionEnd(input);fireEvent.blur(input);
 expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenLastCalledWith({type:'set-song-part',lineIds:['a','b'],value:'自由段落'});
 fireEvent.click(screen.getByText('清除歌曲段落'));expect(apply).toHaveBeenLastCalledWith({type:'set-song-part',lineIds:['a','b'],value:null});
});
it('background is read-only and mixed main/background edits only explicitly selected mains',()=>{
 const document=createLyricDocument();document.lines=[{...createLine('','a'),songPart:'Custom'},{...createLine('','bg'),backgroundOf:'a'},createLine('','b')];const apply=vi.fn(()=>true);
 const view=render(<SongPartField document={document} lines={[document.lines[1]]} apply={apply}/>);expect(screen.getByLabelText('歌曲段落')).toHaveAttribute('readonly');expect(screen.getByLabelText('歌曲段落')).toHaveValue('Custom');
 view.rerender(<SongPartField document={document} lines={document.lines.slice(1)} apply={apply}/>);fireEvent.change(screen.getByLabelText('歌曲段落'),{target:{value:'Other'}});fireEvent.blur(screen.getByLabelText('歌曲段落'));expect(apply).toHaveBeenCalledWith({type:'set-song-part',lineIds:['b'],value:'Other'});
});
