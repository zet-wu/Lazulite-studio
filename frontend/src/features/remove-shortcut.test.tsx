import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createLine } from '../domain/lyric-document';
import { createProjectDocument } from '../domain/project-document';
import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { AudioReviewProvider, useAudioReview } from './AudioReviewContext';
import { KaraokeContext } from './KaraokeContext';
import { KaraokeTrack } from './KaraokeTrack';
import { CueSlot } from './KaraokeTools';
import { VocalTracks } from './VocalTracks';
import { defaultBindings } from './shortcuts';

afterEach(() => { cleanup(); localStorage.clear(); });
const key = (node: Element, code='Delete', extra={}) => fireEvent.keyDown(node,{key:code,code,...extra});
function fixture() {
 const project=createProjectDocument();project.lyrics.lines=[createLine('あ','l')];
 Object.assign(project.lyrics.lines[0].words[0],{beginMs:2000,endMs:3000});
 const cue={id:'c',text:'●',anchor:{kind:'before' as const,lineId:'l'},beginMs:1000,endMs:2000};
 project.karaoke.cues=[cue];project.acoustics.segments=[{id:'s',beginMs:500,endMs:1500}];
 return {project,cue};
}
for (const custom of [false,true]) it(`deletes vocal selection from lane/child with ${custom?'custom':'default'} binding`,()=>{
 if(custom)localStorage.setItem('lazulite-shortcuts',JSON.stringify({...defaultBindings,remove:{...defaultBindings.remove,code:'Backspace',alt:true}}));
 const {project}=fixture(), apply=vi.fn(), leaked=vi.fn();
 function View(){const review=useAudioReview();return <div onKeyDown={leaked}><button onClick={()=>review.setSelected(['s'])}>select</button><VocalTracks sourceDurationMs={4000} projectId="p" acoustics={project.acoustics} startMs={0} endMs={4000} durationMs={4000} bpm={0} snap={false} anchors={[]} showEnergy={false} showSegments lineLabel="" selectedLineId={null} apply={apply} assign={()=>{}} pause={()=>{}}><input aria-label="input"/></VocalTracks></div>;}
 const view=render(<QueryClientProvider client={new QueryClient()}><AudioReviewProvider><View/></AudioReviewProvider></QueryClientProvider>);
 fireEvent.click(view.getByText('select'));const lane=view.container.querySelector('[data-vocal-lane]')!;
 key(view.getByLabelText('input'),custom?'Backspace':'Delete',{altKey:custom});expect(apply).not.toHaveBeenCalled();leaked.mockClear();
 if(custom){key(lane);expect(apply).not.toHaveBeenCalled();leaked.mockClear();}
 key(custom?lane:view.container.querySelector('[data-segment-id] span')!,custom?'Backspace':'Delete',{altKey:custom});
 expect(apply).toHaveBeenCalledWith({...project.acoustics,segments:[]});expect(leaked).not.toHaveBeenCalled();
});

it('deletes a cue from its handle or selected track container without reaching lyric shortcuts',()=>{
 const {project}=fixture(), apply=vi.fn(), leaked=vi.fn();
 function View(){const shared=useEditorSelection()!;return <div onKeyDown={leaked}><button onClick={()=>shared.selectCue('c','l')}>select</button><KaraokeTrack startMs={0} endMs={4000} snap={false} bpm={0} anchors={[]} onError={()=>{}}/></div>;}
 const view=render(<SelectionProvider><KaraokeContext.Provider value={{project,apply,locked:false}}><View/></KaraokeContext.Provider></SelectionProvider>);
 key(view.container.querySelector('[data-cue-id] button')!);expect(apply).toHaveBeenLastCalledWith({type:'karaoke',command:{kind:'remove',id:'c'}});
 fireEvent.click(view.getByText('select'));apply.mockClear();key(view.container.querySelector('[tabindex="-1"]')!);
 expect(apply).toHaveBeenCalledTimes(1);expect(leaked).not.toHaveBeenCalled();
});

it('honors locks, repeats, IME and open dialogs for cue deletion',()=>{
 const {project}=fixture(),apply=vi.fn();
 const view=render(<SelectionProvider><KaraokeContext.Provider value={{project,apply,locked:true}}><KaraokeTrack startMs={0} endMs={4000} snap={false} bpm={0} anchors={[]} onError={()=>{}}/></KaraokeContext.Provider></SelectionProvider>);
 const handle=view.container.querySelector('[data-cue-id] button')!;
 key(handle);expect(apply).not.toHaveBeenCalled();
 view.rerender(<SelectionProvider><KaraokeContext.Provider value={{project,apply,locked:false}}><KaraokeTrack startMs={0} endMs={4000} snap={false} bpm={0} anchors={[]} onError={()=>{}}/></KaraokeContext.Provider></SelectionProvider>);
 key(handle,'Delete',{repeat:true});key(handle,'Delete',{isComposing:true});
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');document.body.append(dialog);key(handle);dialog.remove();
 expect(apply).not.toHaveBeenCalled();
});

it('uses custom list cue removal and leaves text editing keys alone',()=>{
 localStorage.setItem('lazulite-shortcuts',JSON.stringify({...defaultBindings,remove:{...defaultBindings.remove,code:'Backspace',alt:true}}));
 const {project,cue}=fixture(),apply=vi.fn(),leaked=vi.fn();
 const view=render(<SelectionProvider><div onKeyDown={leaked}><CueSlot project={project} anchor={cue.anchor} apply={apply}/></div></SelectionProvider>);
 const entry=view.container.querySelector('[data-cue-id]')!;
 const child=document.createElement('span');entry.append(child);key(child,'Backspace',{altKey:true});expect(apply).toHaveBeenLastCalledWith({kind:'remove',id:'c'});expect(leaked).not.toHaveBeenCalled();
 apply.mockClear();fireEvent.doubleClick(entry);key(view.getByRole('textbox'),'Backspace',{altKey:true});expect(apply).not.toHaveBeenCalled();
});
