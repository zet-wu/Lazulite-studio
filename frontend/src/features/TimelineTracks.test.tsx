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
  Object.defineProperty(window.document,'elementFromPoint',{configurable:true,value:()=>bar});
  const pointer=(type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});fireEvent(bar,event);};
  pointer('pointerdown',100);pointer('pointermove',200);pointer('pointerup',200);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({key:'time.endOutsideSource'}));
  expect(apply).not.toHaveBeenCalled();
  pointer('pointerdown',100);pointer('pointermove',200);pointer('pointermove',140);pointer('pointerup',140);
  expect(apply).toHaveBeenCalledWith({type:'shift-lines',lineIds:[document.lines[0].id],deltaMs:400});
  cleanup();box.mockRestore();vi.unstubAllGlobals();
});

it('stages complete ancestors, switches to the active row and filters each subtrack',async()=>{
 const {cleanup,fireEvent}=await import('@testing-library/react');cleanup();
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 const doc=createLyricDocument('愛'),line=doc.lines[0],word=line.words[0];
 line.beginMs=100;line.endMs=2000;word.beginMs=100;word.endMs=1500;
 word.rubyUnits=[{id:'missing-ruby',reading:'あい',beginMs:null,endMs:null}];
 doc.romanizationTracks=[{id:'track',language:'ja-Latn',contents:[{id:'content',lineId:line.id,kind:'timed',units:[{id:'missing-roman',text:'ai',beginMs:null,endMs:null}]}]}];
 const onLocate=vi.fn(),apply=vi.fn();
 const props={document:doc,selectedLineId:null,startMs:0,endMs:3000,durationMs:3000,positionMs:0,bpm:0,snap:false,visible:{karaoke:false,line:true,word:true,ruby:true,romanization:true,gap:false},apply,onPan:vi.fn(),onLocate,onError:vi.fn()};
 const view=render(<SelectionProvider><TimelineTracks {...props}/></SelectionProvider>);
 const staging=()=>view.container.querySelector('[aria-label="暂存区"]')!;
 expect(staging().querySelectorAll('[data-staging-key]')).toHaveLength(1);
 fireEvent.keyDown(staging().querySelector('[role="button"]')!,{key:'Enter'});
 expect(onLocate).toHaveBeenCalledWith(100,2000);expect(apply).not.toHaveBeenCalled();
 expect(staging().querySelectorAll('[data-staging-key]')).toHaveLength(3);
 expect(staging().querySelector(`[data-staging-key="${word.id}"]`)).not.toBeNull();
 view.rerender(<SelectionProvider><TimelineTracks {...props} visible={{...props.visible,ruby:false,romanization:false}}/></SelectionProvider>);
 expect(staging().querySelectorAll('[data-staging-key]')).toHaveLength(1);
 view.rerender(<SelectionProvider><TimelineTracks {...props} visible={{...props.visible,word:false,ruby:false,romanization:false}}/></SelectionProvider>);
 expect(staging()).not.toBeNull();expect(staging().querySelectorAll('[data-staging-key]')).toHaveLength(0);cleanup();vi.unstubAllGlobals();
});

it('unions real active overlaps and backgrounds with manual expansion without changing selection',async()=>{
 const {cleanup}=await import('@testing-library/react');cleanup();
 const {createLine}=await import('../domain/lyric-document');
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 const scrolling=vi.fn();Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scrolling});
 localStorage.removeItem('studio:timeline-auto-expand');
 const document=createLyricDocument('');
 document.lines=[[0,1000],[1000,3000],[1500,3500],[null,4000]].map(([beginMs,endMs],index)=>({...createLine('歌',`line-${index}`),beginMs,endMs,backgroundOf:index===2?'line-1':null}));
 const props={document,selectedLineId:'line-0',startMs:0,endMs:5000,positionMs:2000,bpm:0,snap:false,visible:{karaoke:false,line:true,word:true,ruby:true,romanization:true,gap:false,staging:false},apply:vi.fn(),onPan:vi.fn(),onError:vi.fn()};
 function Probe(){const {selection}=useEditorSelection()!;return <output data-testid="selection">{selection?.activeId}</output>;}
 const show=(follow:boolean,positionMs=2000)=><SelectionProvider><InitialSelection id="line-0"><Probe/><TimelineTracks {...props} follow={follow} positionMs={positionMs}/></InitialSelection></SelectionProvider>;
 const view=render(show(false));const groups=()=>[...view.container.querySelectorAll<HTMLElement>('[data-expanded-line]')].map(node=>node.dataset.expandedLine);
 expect(groups()).toEqual(['line-0']);view.rerender(show(true));expect(groups()).toEqual(['line-0','line-1','line-2']);expect(screen.getByTestId('selection')).toHaveTextContent('line-0');
 view.rerender(show(true,3000));expect(groups()).toEqual(['line-0','line-2']);view.rerender(show(true,3500));expect(groups()).toEqual(['line-0']);
 localStorage.setItem('studio:timeline-auto-expand','always');view.rerender(show(false));expect(groups()).toEqual(['line-0','line-1','line-2']);
 localStorage.setItem('studio:timeline-auto-expand','off');view.rerender(show(true));expect(groups()).toEqual(['line-0']);
 expect(screen.getByTestId('selection')).toHaveTextContent('line-0');expect(props.apply).not.toHaveBeenCalled();expect(props.onPan).not.toHaveBeenCalled();
 cleanup();localStorage.removeItem('studio:timeline-auto-expand');vi.unstubAllGlobals();
});

it('filters expanded groups before layout, keeps visible children and restores expansion on pan',async()=>{
 const {cleanup,fireEvent}=await import('@testing-library/react');cleanup();
 const {createLine}=await import('../domain/lyric-document');
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 const document=createLyricDocument('');
 document.lines=Array.from({length:30},(_,i)=>{const line=createLine(`歌${i}`,`line-${i}`);line.beginMs=i*1000;line.endMs=i*1000+800;Object.assign(line.words[0],{beginMs:line.beginMs,endMs:line.endMs});return line;});
 document.lines[0].beginMs=null;document.lines[0].endMs=null;
 document.lines[1].backgroundOf='line-0';
 function Expand(){const {setSelection}=useEditorSelection()!;useEffect(()=>setSelection({kind:'lines',ids:document.lines.map(l=>l.id),activeId:'line-0',anchorId:'line-0'}),[]);return null;}
 const props={document,selectedLineId:'line-0',startMs:0,endMs:900,positionMs:0,bpm:0,snap:false,visible:{karaoke:false,line:true,word:true,ruby:true,romanization:true,gap:false,staging:false},apply:vi.fn(),onPan:vi.fn(),onError:vi.fn()};
 const show=(startMs:number,endMs:number)=><SelectionProvider><Expand/><TimelineTracks {...props} startMs={startMs} endMs={endMs}/></SelectionProvider>;
 const view=render(show(0,900));const groups=()=>[...view.container.querySelectorAll<HTMLElement>('[data-expanded-line]')].map(n=>n.dataset.expandedLine);
 expect(groups()).toEqual(['line-0']);
 const word=view.container.querySelector<HTMLElement>('[data-timeline-key="'+document.lines[0].words[0].id+'"]')!;fireEvent.focusIn(word);
 view.rerender(show(2000,2900));expect(groups()).toEqual(['line-0','line-2']);
 fireEvent.focusIn(window.document.body);expect(groups()).toEqual(['line-2']);
 view.rerender(show(0,900));expect(groups()).toEqual(['line-0']);
 expect(props.apply).not.toHaveBeenCalled();cleanup();vi.unstubAllGlobals();
});

it('commits drags released across the right-hand plot area and rejects labels, toolbar, overlays, and non-move staging drops', async () => {
  const { cleanup, fireEvent } = await import('@testing-library/react'); cleanup();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const document = createLyricDocument('歌');
  const line = document.lines[0];
  Object.assign(line, { beginMs: 1000, endMs: 3000 });
  Object.assign(line.words[0], { beginMs: 1000, endMs: 3000 });
  const apply = vi.fn(), onError = vi.fn();
  const rect = (left: number, top: number, right: number, bottom: number): DOMRect => ({
    left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {},
  });
  const view = render(
    <div>
      <div id="external-overlay">overlay</div>
      <div id="timeline-plots">
        <div data-testid="toolbar">toolbar</div>
        <div data-timeline-plot-area>
          <div data-testid="wave">wave</div>
          <div data-testid="energy">energy</div>
          <SelectionProvider>
            <InitialSelection id={line.id}>
              <TimelineTracks
                document={document}
                selectedLineId={line.id}
                startMs={0}
                endMs={10000}
                durationMs={10000}
                positionMs={0}
                bpm={120}
                snap={false}
                visible={{ staging: true, karaoke: false, line: true, word: true, ruby: false, gap: false, romanization: false }}
                apply={apply}
                onPan={() => {}}
                onError={onError}
              />
            </InitialSelection>
          </SelectionProvider>
          <div data-testid="spectrogram">spectrogram</div>
        </div>
      </div>
    </div>,
  );
  const plots = view.container.querySelector<HTMLElement>('#timeline-plots')!;
  const toolbar = screen.getByTestId('toolbar');
  const plotArea = view.container.querySelector<HTMLElement>('[data-timeline-plot-area]')!;
  const wave = screen.getByTestId('wave');
  const energy = screen.getByTestId('energy');
  const spectrogram = screen.getByTestId('spectrogram');
  const overlay = view.container.querySelector<HTMLElement>('#external-overlay')!;
  const lane = view.container.querySelector<HTMLElement>('[data-track-lane]')!;
  const label = view.container.querySelector<HTMLElement>('[data-timeline-text]')!;
  const staging = view.container.querySelector<HTMLElement>('[data-staging-drop]')!;
  const lineBar = screen.getByRole('button', { name: '时间轴行 L1' });
  const endHandle = screen.getByLabelText('时间轴行 L1结束边界');
  const wordBeginHandle = screen.getByLabelText('时间轴词 歌开始边界');
  for (const el of [lineBar, endHandle, wordBeginHandle]) {
    el.setPointerCapture = vi.fn();
    el.hasPointerCapture = vi.fn(() => false);
  }
  plotArea.getBoundingClientRect = () => rect(0, 40, 1060, 320);
  for (const el of view.container.querySelectorAll<HTMLElement>('[data-track-lane]')) {
    el.getBoundingClientRect = () => rect(60, 140, 1060, 162);
  }

  let hit: Element = lane;
  Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: () => hit });
  const pointer = (target: HTMLElement, type: string, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(target, event);
  };
  const drag = (target: HTMLElement, x0: number, y0: number, x1: number, y1: number, dropTarget: Element) => {
    hit = target;
    pointer(target, 'pointerdown', x0, y0);
    hit = dropTarget;
    pointer(target, 'pointermove', x1, y1);
    pointer(target, 'pointerup', x1, y1);
  };

  drag(endHandle, 360, 150, 460, 60, wave);
  expect(apply).toHaveBeenCalledTimes(1);
  drag(wordBeginHandle, 160, 180, 210, 280, spectrogram);
  expect(apply).toHaveBeenCalledTimes(2);
  drag(lineBar, 200, 150, 250, 100, energy);
  expect(apply).toHaveBeenCalledTimes(3);
  drag(lineBar, 200, 150, 260, 170, plots);
  expect(apply).toHaveBeenCalledTimes(4);

  drag(lineBar, 200, 150, 30, 150, label);
  drag(endHandle, 360, 150, 460, 20, toolbar);
  drag(lineBar, 200, 150, 250, 150, overlay);
  drag(endHandle, 360, 150, 460, 220, staging);
  expect(apply).toHaveBeenCalledTimes(4);

  drag(lineBar, 200, 150, 250, 220, staging);
  expect(apply).toHaveBeenCalledTimes(5);
  expect(apply).toHaveBeenLastCalledWith({
    type: 'replace-document',
    document: expect.objectContaining({
      lines: [expect.objectContaining({ beginMs: null, endMs: null })],
    }),
  });

  cleanup();
  vi.unstubAllGlobals();
});
