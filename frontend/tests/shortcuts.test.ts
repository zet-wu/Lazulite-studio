import { expect, it } from 'vitest';
import { bindingError, captureBinding, defaultBindings, formatBinding, matchesBinding } from '../src/features/shortcuts';

it('allows disjoint arrow scopes but rejects global and fixed conflicts with exact modifiers', () => {
  expect(bindingError('previous', defaultBindings.previous, defaultBindings)).toBeNull();
  expect((bindingError('play', defaultBindings.previous, defaultBindings))?.key).toBe('shortcuts.conflict');
  expect((bindingError('start', { ...defaultBindings.start, ctrl: true }, defaultBindings))?.key).toBe('shortcuts.conflict');
  expect(matchesBinding(new KeyboardEvent('keydown', { code: 'KeyS', shiftKey: true }), defaultBindings.start)).toBe(false);
  const custom = captureBinding(new KeyboardEvent('keydown', { code: 'KeyG', altKey: true, shiftKey: true }));
  expect(bindingError('start', custom, defaultBindings)).toBeNull();
  expect(bindingError('start', { ...custom, alt: false, meta: true }, defaultBindings)).toBeNull();
  expect(formatBinding(custom, true)).toBe('⌥ + ⇧ + G');
  expect(formatBinding(custom, false)).toBe('Alt + Shift + G');
});

it('reserves plain Space for playback even when playback has an additional custom key', () => {
  const bindings = {...defaultBindings, play: {...defaultBindings.play, code: 'KeyP'}};
  expect(bindingError('start', defaultBindings.play, bindings)?.key).toBe('shortcuts.reserved');
  expect(bindingError('play', bindings.play, bindings)).toBeNull();
});

it('recovers an invalid entry without discarding other custom actions or missing new defaults',async()=>{
 const {readBindings}=await import('../src/features/shortcuts');
 localStorage.setItem('lazulite-shortcuts',JSON.stringify({start:{...defaultBindings.start,code:'KeyG'},end:{...defaultBindings.end,code:'F5'}}));
 const values=readBindings();expect(values.start.code).toBe('KeyG');expect(values.end).toEqual(defaultBindings.end);expect(values.faster).toEqual(defaultBindings.faster);
 localStorage.clear();
});

it('keeps a valid swap between two saved action bindings',async()=>{
 const {readBindings}=await import('../src/features/shortcuts');
 localStorage.setItem('lazulite-shortcuts',JSON.stringify({...defaultBindings,merge:defaultBindings.split,split:defaultBindings.merge}));
 const result=readBindings();expect(result.merge).toEqual(defaultBindings.split);expect(result.split).toEqual(defaultBindings.merge);localStorage.clear();
});
