import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('skips disabled items, retains focus on rerender, restores on Escape and respects outside focus',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const target=document.createElement('button');document.body.append(target);const outside=document.createElement('input');document.body.append(outside);
 const close=vi.fn(),run=vi.fn();const actions=[{label:'disabled',disabled:true,run},{label:'merge',run},{label:'delete',danger:true,run}];
 const view=render(<ContextMenu x={10} y={10} title="menu" actions={actions} close={close} target={target}/>);
 expect(screen.getByRole('menuitem',{name:'merge'})).toHaveFocus();fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});expect(screen.getByRole('menuitem',{name:'delete'})).toHaveFocus();view.rerender(<ContextMenu x={10} y={10} title="menu" actions={actions} close={()=>close()} target={target}/>);expect(screen.getByRole('menuitem',{name:'delete'})).toHaveFocus();fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});expect(screen.getByRole('menuitem',{name:'merge'})).toHaveFocus();fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(target).toHaveFocus();
 outside.focus();view.unmount();expect(outside).toHaveFocus();target.remove();outside.remove();expect(run).not.toHaveBeenCalled();
});
