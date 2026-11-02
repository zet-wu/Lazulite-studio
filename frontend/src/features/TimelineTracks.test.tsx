import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { useEffect, type ReactNode } from 'react';
function InitialSelection({ id, children }: { id: string; children: ReactNode }) { const { setSelection } = useEditorSelection()!; useEffect(() => { setSelection({ kind: 'lines', ids: [id], activeId: id, anchorId: id }); }, [id]); return children; }
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createLyricDocument } from '../domain/lyric-document';
import { TimelineTracks } from './TimelineTracks';

it('uses half-open independent intervals across line, word and 注音 at seek and paused positions', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const document = createLyricDocument('合成');
  const line = document.lines[0], word = line.words[0];
  line.beginMs = 1000; line.endMs = 4000;
  word.beginMs = 2000; word.endMs = 3000;
  word.rubyUnits = [{ id: 'ruby', reading: 'ごうせい', beginMs: 2000, endMs: 2001 }];
  const props = { document, selectedLineId: line.id, selectedRomanization: null, startMs: 0, endMs: 5000, bpm: 0, snap: false,
    visible: { karaoke: true, line: true, word: true, ruby: true, gap: false, romanization: true }, apply: vi.fn(), onSelectLine: vi.fn(), onPan: vi.fn(), onError: vi.fn() };
  const { rerender } = render(<SelectionProvider><InitialSelection id={props.selectedLineId}><TimelineTracks {...props} positionMs={0} /></InitialSelection></SelectionProvider>);
  for (const [positionMs, expected] of [[1000, [true, false, false]], [2000, [true, true, true]], [2001, [true, true, false]], [3000, [true, false, false]], [4000, [false, false, false]]] as const) {
    rerender(<SelectionProvider><InitialSelection id={props.selectedLineId}><TimelineTracks {...props} positionMs={positionMs} /></InitialSelection></SelectionProvider>);
    for (const [index, kind] of ['行', '词', '注音'].entries()) expect(screen.getByRole('button', { name: new RegExp(`^时间轴${kind} `) }).getAttribute('aria-current') === 'time').toBe(expected[index]);
  }
  vi.unstubAllGlobals();
});

it('packs only visible intervals, retains crossing objects and cancels an edit when its viewport changes', async () => {
  const { fireEvent, cleanup } = await import('@testing-library/react'); cleanup();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const { createLine } = await import('../domain/lyric-document');
  const document = createLyricDocument();
  document.lines = [[0, 3], [1, 4], [5, 6], [6, 7]].map(([beginMs, endMs], i) => ({ ...createLine('', String(i)), beginMs: beginMs * 1e3, endMs: endMs * 1e3 }));
  const props = { document, selectedLineId: '2', selectedRomanization: null, startMs: 0, endMs: 8e3, positionMs: 0, bpm: 0, snap: false, visible: { karaoke: true, line: true, word: false, ruby: false, gap: false, romanization: true }, apply: vi.fn(), onSelectLine: vi.fn(), onPan: vi.fn(), onError: vi.fn() };
  const { rerender } = render(<SelectionProvider><InitialSelection id={props.selectedLineId}><TimelineTracks {...props} /></InitialSelection></SelectionProvider>);
  const bar = screen.getByRole('button', { name: '时间轴行 L3' });
  bar.setPointerCapture = vi.fn();
  bar.hasPointerCapture = vi.fn(() => false);
  fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
  rerender(<SelectionProvider><InitialSelection id={props.selectedLineId}><TimelineTracks {...props} startMs={5.5e3} endMs={7e3} /></InitialSelection></SelectionProvider>);
  fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 });
  expect(props.apply).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '时间轴行 L3' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '时间轴行 L1' })).not.toBeInTheDocument();
  cleanup(); vi.unstubAllGlobals();
});

it('hiding the cue layer unmounts the lane and releases an uncommitted pointer drag',async()=>{
  const { fireEvent, cleanup }=await import('@testing-library/react');cleanup();
  const { KaraokeContext }=await import('./KaraokeContext');
  const { createProjectDocument }=await import('../domain/project-document');
  vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
  const document=createLyricDocument('歌词'),project=createProjectDocument(document),apply=vi.fn();
  project.karaoke.cues=[{id:'cue',text:'唱',beginMs:0,endMs:500,anchor:{kind:'before',lineId:document.lines[0].id}}];
  const props={document,selectedLineId:null,startMs:0,endMs:5000,positionMs:0,bpm:0,snap:false,visible:{karaoke:true,line:true,word:true,ruby:true,gap:true,romanization:true},apply:vi.fn(),onPan:vi.fn(),onError:vi.fn()};
  const show=(visible:boolean)=><SelectionProvider><KaraokeContext.Provider value={{project,apply,locked:false}}><TimelineTracks {...props} visible={{...props.visible,karaoke:visible}}/></KaraokeContext.Provider></SelectionProvider>;
  const view=render(show(true)),bar=screen.getByRole('button',{name:'时间轴导唱 唱'});
  bar.setPointerCapture=vi.fn();bar.hasPointerCapture=vi.fn(()=>true);bar.releasePointerCapture=vi.fn();
  const down=new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:100});Object.defineProperty(down,'pointerId',{value:7});fireEvent(bar,down);
  expect(bar.setPointerCapture).toHaveBeenCalledWith(7);
  view.rerender(show(false));expect(screen.queryByLabelText('导唱轨道')).not.toBeInTheDocument();expect(bar.releasePointerCapture).toHaveBeenCalledWith(7);expect(apply).not.toHaveBeenCalled();
  view.rerender(show(true));expect(screen.getByRole('button',{name:'时间轴导唱 唱'})).toHaveAttribute('aria-pressed','true');expect(project.karaoke.cues[0].beginMs).toBe(0);
  cleanup();vi.unstubAllGlobals();
});

it('rejects a dragged block tail beyond the source and commits after moving back', async () => {
  const {cleanup,fireEvent}=await import('@testing-library/react');cleanup();
  vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
  const box=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:1000,height:100,right:1000,bottom:100,x:0,y:0,toJSON(){}});
  const document=createLyricDocument('歌');Object.assign(document.lines[0],{beginMs:8000,endMs:9500});
  const apply=vi.fn(),onError=vi.fn();
  render(<SelectionProvider><InitialSelection id={document.lines[0].id}><TimelineTracks document={document} selectedLineId={document.lines[0].id} startMs={0} endMs={10000} durationMs={10000} positionMs={0} bpm={120} snap={false} visible={{karaoke:false,line:true,word:false,ruby:false,gap:false,romanization:false}} apply={apply} onPan={()=>{}} onError={onError}/></InitialSelection></SelectionProvider>);
  const bar=screen.getByRole('button',{name:'时间轴行 L1'});
  bar.setPointerCapture=vi.fn();bar.hasPointerCapture=vi.fn(()=>false);
  const pointer=(type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});fireEvent(bar,event);};
  pointer('pointerdown',100);pointer('pointermove',200);pointer('pointerup',200);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('结束'));
  expect(apply).not.toHaveBeenCalled();
  pointer('pointerdown',100);pointer('pointermove',200);pointer('pointermove',140);pointer('pointerup',140);
  expect(apply).toHaveBeenCalledWith({type:'shift-lines',lineIds:[document.lines[0].id],deltaMs:400});
  cleanup();box.mockRestore();vi.unstubAllGlobals();
});
