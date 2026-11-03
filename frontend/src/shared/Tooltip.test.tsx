import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('delays hover, cancels a quick pass, retains reading across the popup, and suppresses until exit',()=>{
 render(<Tooltip content="full detail" id="detail"><button aria-describedby="detail">trigger</button></Tooltip>);
 const trigger=screen.getByRole('button');fireEvent.mouseEnter(trigger);act(()=>vi.advanceTimersByTime(200));expect(document.querySelector('[role="tooltip"]')).toBeNull();fireEvent.mouseLeave(trigger);act(()=>vi.advanceTimersByTime(700));expect(document.querySelector('[role="tooltip"]')).toBeNull();
 fireEvent.mouseEnter(trigger);act(()=>vi.advanceTimersByTime(600));const popup=document.querySelector('[role="tooltip"]')!;expect(popup).toHaveTextContent('full detail');fireEvent.mouseLeave(trigger);fireEvent.mouseEnter(popup);act(()=>vi.advanceTimersByTime(200));expect(popup.isConnected).toBe(true);
 fireEvent.mouseLeave(popup);act(()=>vi.advanceTimersByTime(200));expect(document.querySelector('[role="tooltip"]')).toBeNull();
 fireEvent.focus(trigger);expect(document.querySelector('[role="tooltip"]')).not.toBeNull();fireEvent.keyDown(trigger,{key:'Escape'});expect(document.querySelector('[role="tooltip"]')).toBeNull();fireEvent.mouseEnter(trigger);act(()=>vi.advanceTimersByTime(700));expect(document.querySelector('[role="tooltip"]')).toBeNull();
 fireEvent.mouseLeave(trigger);fireEvent.blur(trigger);act(()=>vi.advanceTimersByTime(200));fireEvent.focus(trigger);expect(document.querySelector('[role="tooltip"]')).not.toBeNull();fireEvent.pointerDown(trigger);expect(document.querySelector('[role="tooltip"]')).toBeNull();expect(trigger).toHaveAccessibleDescription('full detail');
});
it('keeps composing Escape for the input and updates the full accessible description',()=>{
 const key=vi.fn();const view=render(<div onKeyDown={key}><Tooltip content="before" id="detail"><input aria-describedby="detail"/></Tooltip></div>);const input=screen.getByRole('textbox');fireEvent.focus(input);fireEvent.keyDown(input,{key:'Escape',isComposing:true});expect(key).toHaveBeenCalled();expect(document.querySelector('[role="tooltip"]')).not.toBeNull();view.rerender(<Tooltip content="after" id="detail"><input aria-describedby="detail"/></Tooltip>);expect(screen.getByRole('textbox')).toHaveAccessibleDescription('after');
});
