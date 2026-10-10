import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine, createLyricDocument } from '../../domain/lyric-document';
import { BatchToolsPanel } from './BatchToolsPanel';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { EditorSelection } from './editing-actions';
afterEach(cleanup);
function mount(selection:EditorSelection|null=null){
 const document=createLyricDocument();document.lines=['a','bg','b'].map(id=>({...createLine(id,id),backgroundOf:id==='bg'?'a':null}));
 for(const line of document.lines)line.words[0].rubyUnits=[{id:line.id+'r',reading:'あ',beginMs:null,endMs:null}];
 const apply=vi.fn((_command: LyricCommand)=>true),close=vi.fn();render(<BatchToolsPanel document={document} selection={selection} currentLineId="a" apply={apply} close={close}/>);return {apply,document};
}
it.each([['current',['ar','bgr']],['all',['ar','bgr','br']],['range',['bgr']]] as const)('clear Ruby uses %s scope without changing line numbering',(scope,expected)=>{
 const {apply}=mount();fireEvent.click(screen.getByRole('button',{name:'清除注音',exact:true}));fireEvent.change(screen.getByLabelText('范围'),{target:{value:scope}});
 if(scope==='range'){const fields=screen.getAllByRole('spinbutton');fireEvent.change(fields[0],{target:{value:'2'}});fireEvent.change(fields[1],{target:{value:'2'}});}
 fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect((apply.mock.calls[0][0] as Extract<LyricCommand,{type:'batch'}>).commands.map(command=>'rubyId' in command?command.rubyId:null)).toEqual(expected);
});
it.each([['a',['ar','bgr']],['bg',['bgr']]] as const)('clear explicit selected row %s honors background expansion',(id,expected)=>{
 const {apply}=mount({kind:'lines',ids:[id],activeId:id,anchorId:id});fireEvent.click(screen.getByRole('button',{name:'清除注音',exact:true}));fireEvent.change(screen.getByLabelText('范围'),{target:{value:'selected'}});fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect((apply.mock.calls[0][0] as Extract<LyricCommand,{type:'batch'}>).commands.map(command=>'rubyId' in command?command.rubyId:null)).toEqual(expected);
});
it('body replacement rejects Ruby selection and explicit Ruby target touches only selected Ruby',()=>{
 const {apply}=mount({kind:'ruby',lineId:'a',wordId:'a:word:0',ids:['ar'],anchorId:'ar',activeId:'ar'});fireEvent.change(screen.getByLabelText('范围'),{target:{value:'selected'}});fireEvent.change(screen.getByLabelText('查找'),{target:{value:'あ'}});fireEvent.change(screen.getByLabelText('替换为'),{target:{value:'い'}});fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('切换替换对象');fireEvent.click(screen.getByRole('radio',{name:'注音',exact:true}));fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));expect((apply.mock.calls[0][0] as Extract<LyricCommand,{type:'batch'}>).commands).toHaveLength(1);expect((apply.mock.calls[0][0] as Extract<LyricCommand,{type:'batch'}>).commands[0]).toMatchObject({type:'edit-ruby',rubyId:'ar',reading:'い'});
});
