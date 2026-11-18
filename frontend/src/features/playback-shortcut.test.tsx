import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlaybackShortcut } from './shortcuts';

afterEach(cleanup);
function Harness({toggle}: {toggle: () => void}) {
  usePlaybackShortcut(toggle);
  return <><button onClick={()=>{throw new Error('unexpected activation');}}>操作</button><input aria-label="正文"/><div tabIndex={0} contentEditable suppressContentEditableWarning>文本</div></>;
}
it('consumes keydown, repeat and keyup once, without removing button focus',()=>{
 const toggle=vi.fn();render(<Harness toggle={toggle}/>);const button=screen.getByRole('button');button.focus();
 expect(fireEvent.keyDown(button,{code:'Space',key:' '})).toBe(false);
 expect(fireEvent.keyDown(button,{code:'Space',key:' ',repeat:true})).toBe(false);
 expect(fireEvent.keyUp(button,{code:'Space',key:' '})).toBe(false);
 expect(toggle).toHaveBeenCalledTimes(1);expect(button).toHaveFocus();
});
it('preserves input, composition, modifiers and modal or menu isolation',()=>{
 const toggle=vi.fn();render(<Harness toggle={toggle}/>);
 for(const target of [screen.getByRole('textbox'),screen.getByText('文本')])expect(fireEvent.keyDown(target,{code:'Space',key:' '})).toBe(true);
 const button=screen.getByRole('button');
 fireEvent.keyDown(button,{code:'Space',key:' ',isComposing:true});fireEvent.keyDown(button,{code:'Space',key:' ',ctrlKey:true});
 for(const role of ['dialog','menu','listbox']){const overlay=document.createElement('div');overlay.setAttribute('role',role);document.body.append(overlay);expect(fireEvent.keyDown(button,{code:'Space',key:' '})).toBe(true);overlay.remove();}
 expect(toggle).not.toHaveBeenCalled();
});
