import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {createLine, createLyricDocument, createWord} from '../../domain/lyric-document';
import {BatchToolsPanel} from './BatchToolsPanel';
import {DialogEditingLocked} from './SettingsDialog';
import {SegmentationPanel} from './SegmentationPanel';
import type {EditorSelection} from './editing-actions';
afterEach(cleanup);
function mount(selection: EditorSelection | null = null) {
 const document=createLyricDocument(); document.lines=[createLine('你好','a'),createLine('世界','bg'),createLine('再见','b')];document.lines[1].backgroundOf='a';document.lines[0].words.push(createWord('天地','second'));
 const apply=vi.fn((..._args: unknown[])=>true);render(<BatchToolsPanel document={document} selection={selection} currentLineId="a" apply={apply} close={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'分词'}));return {document,apply};
}
it('keeps separate drafts for every word across scope changes and submits once',()=>{
 const {apply}=mount();
 for(const button of screen.getAllByRole('button',{name:'切分边界 1'})) fireEvent.click(button);
 fireEvent.change(screen.getByLabelText('范围'),{target:{value:'all'}});
 expect(screen.getAllByRole('button',{pressed:true,name:'切分边界 1'})).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect(apply).toHaveBeenCalledOnce();expect(apply.mock.calls[0]).toMatchObject([{type:'segment-words',changes:[{words:[{text:'你'},{text:'好'}]},{words:[{text:'天'},{text:'地'}]},{words:[{text:'世'},{text:'界'}]}]}]);
});
it.each(['bg','a'])('selected line %s preserves background object or expands main group',id=>{
 mount({kind:'lines',ids:[id],activeId:id,anchorId:id});fireEvent.change(screen.getByLabelText('范围'),{target:{value:'selected'}});
 expect(screen.getAllByLabelText('字符切分边界')).toHaveLength(id==='bg'?1:3);
});
it('empty selection has no fallback, selected words keep only those targets',()=>{
 const {apply}=mount();fireEvent.change(screen.getByLabelText('范围'),{target:{value:'selected'}});expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();expect(apply).not.toHaveBeenCalled();
});
it('preserves the batch range when changing operations',()=>{
 mount();fireEvent.change(screen.getByLabelText('范围'),{target:{value:'range'}});fireEvent.click(screen.getByRole('button',{name:'替换'}));fireEvent.click(screen.getByRole('button',{name:'分词'}));expect(screen.getByLabelText('范围')).toHaveValue('range');
});
it('single word presets retain edits on rerender and graphemes remain intact',()=>{
 const document=createLyricDocument('你好e\u0301👩‍👩‍👧‍👦'),word=document.lines[0].words[0],apply=vi.fn((..._args: unknown[])=>true);
 const props={document,wordIds:[word.id],singleWord:true,apply,close:()=>{}};const view=render(<SegmentationPanel {...props}/>);
 const first=screen.getByRole('button',{name:'切分边界 1'});fireEvent.click(first);view.rerender(<SegmentationPanel {...props}/>);expect(screen.getByRole('button',{name:'切分边界 1'})).toHaveAttribute('aria-pressed','false');expect(screen.getAllByRole('button',{name:/边界/})).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect(apply.mock.calls[0]).toMatchObject([{changes:[{words:[{text:'你好'},{text:'é'},{text:'👩‍👩‍👧‍👦'}]}]}]);
});
it('auto excludes hidden advanced rules and weight, restricted words remain protected',async()=>{
 const document=createLyricDocument('hello');document.lines[0].words.push({...createWord('你好'),obscene:true});const wordIds=document.lines[0].words.map(w=>w.id),apply=vi.fn((..._args: unknown[])=>true);
 render(<SegmentationPanel document={document} wordIds={wordIds} apply={apply} close={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('模式'),{target:{value:'advanced'}});fireEvent.change(screen.getByLabelText('自定义规则（每行 原文=部分|部分）'),{target:{value:'hello=hel|lo'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeEnabled());
 fireEvent.change(screen.getByLabelText('模式'),{target:{value:'auto'}});expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();
 await waitFor(()=>expect(screen.getByTitle('含消音属性，保留原词')).toBeVisible());expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();
});
it('selected word scope filters within a main line without including its other words or background',()=>{
 mount({kind:'words',lineId:'a',ids:['second'],activeId:'second',anchorId:'second'});fireEvent.change(screen.getByLabelText('范围'),{target:{value:'selected'}});expect(screen.getAllByLabelText('字符切分边界')).toHaveLength(1);
});
it('manual mixed targets apply only unrestricted words',()=>{
 const document=createLyricDocument('你好'),words=document.lines[0].words;words.push({...createWord('世界'),obscene:true});const apply=vi.fn(),close=vi.fn();render(<SegmentationPanel document={document} wordIds={words.map(w=>w.id)} apply={apply} close={close}/>);
 const points=screen.getAllByRole('button',{name:'切分边界 1'});fireEvent.click(points[0]);expect(points).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect(apply.mock.calls[0][0].changes).toHaveLength(1);
});

it('automatic whole range previews all existing words, and locked single-word dialog cannot submit',async()=>{
 const {apply}=mount();fireEvent.change(screen.getByLabelText('范围'),{target:{value:'all'}});fireEvent.change(screen.getByLabelText('模式'),{target:{value:'auto'}});await waitFor(()=>expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect(apply.mock.calls[0]).toMatchObject([{changes:[{lineId:'a'},{lineId:'a'},{lineId:'bg'},{lineId:'b'}]}]);
 cleanup();const document=createLyricDocument('你好');render(<DialogEditingLocked.Provider value={true}><SegmentationPanel document={document} wordIds={[document.lines[0].words[0].id]} singleWord apply={apply} close={()=>{}}/></DialogEditingLocked.Provider>);expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();expect(screen.getByRole('button',{name:'切分边界 1'})).toBeDisabled();expect(screen.getByRole('button',{name:'取消'})).toBeEnabled();
});

it('moves selected ruby by keyboard action and submits the visible envelope',()=>{
 const document=createLyricDocument('甲乙丙丁'),word=document.lines[0].words[0];
 word.beginMs=0;word.endMs=1000;word.rubyUnits=['a','b','c','d'].map((reading,i)=>({id:reading,reading,beginMs:100+i*100,endMs:200+i*100}));
 const apply=vi.fn(()=>true);render(<SegmentationPanel document={document} wordIds={[word.id]} apply={apply} close={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'切分边界 2'}));
 fireEvent.click(screen.getByRole('button',{name:'a'}));fireEvent.keyDown(screen.getByRole('button',{name:'a'}),{key:'ArrowRight'});
 fireEvent.click(screen.getByRole('button',{name:'b'}));fireEvent.keyDown(screen.getByRole('button',{name:'b'}),{key:'ArrowRight'});
 fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));
 expect(apply.mock.calls[0]).toMatchObject([{changes:[{words:[{text:'甲乙',beginMs:100,endMs:200,rubyUnits:[{id:'a'}]},{text:'丙丁',beginMs:200,endMs:500,rubyUnits:[{id:'b'},{id:'c'},{id:'d'}]}]}]}]);
});
it('multi-select ruby and removing all boundaries restores an uncommittable original',()=>{
 const document=createLyricDocument('甲乙'),word=document.lines[0].words[0];word.rubyUnits=['a','b'].map(reading=>({id:reading,reading,beginMs:null,endMs:null}));
 render(<SegmentationPanel document={document} wordIds={[word.id]} apply={vi.fn()} close={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'切分边界 1'}));fireEvent.click(screen.getByRole('button',{name:'a'}));fireEvent.click(screen.getByRole('button',{name:'b'}),{ctrlKey:true});
 expect(screen.getAllByRole('button',{pressed:true}).filter(el=>['a','b'].includes(el.textContent??''))).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'切分边界 1'}));expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();
});

it('shares an exclusive ruby selection, with editor Ctrl toggling and Shift ranges within a source',()=>{
 const document=createLyricDocument('甲乙丙丁'),source=document.lines[0].words[0],other=createWord('天地');
 source.rubyUnits=['a','b','c','d'].map(reading=>({id:reading,reading,beginMs:null,endMs:null}));
 other.rubyUnits=['x','y'].map(reading=>({id:reading,reading,beginMs:null,endMs:null}));document.lines[0].words.push(other);
 render(<SegmentationPanel document={document} wordIds={[source.id,other.id]} apply={vi.fn()} close={()=>{}}/>);
 const click=(name:string,modifiers={})=>fireEvent.click(screen.getByRole('button',{name}),modifiers);
 const selected=()=>screen.getAllByRole('button',{pressed:true}).map(button=>button.textContent);
 click('a');click('c',{shiftKey:true});expect(selected()).toEqual(['a','b','c']);
 click('b',{ctrlKey:true});expect(selected()).toEqual(['a','c']);
 click('x');expect(selected()).toEqual(['x']);
 click('b',{ctrlKey:true});expect(selected()).toEqual(['b']);
 click('y',{shiftKey:true});expect(selected()).toEqual(['y']);
 click('x',{metaKey:true});expect(selected()).toEqual(['x','y']);
 click('x');expect(selected()).toEqual(['x']);
});
