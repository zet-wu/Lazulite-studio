import { expect, it } from 'vitest';
import { bindingError, captureBinding, defaultBindings, formatBinding, matchesBinding, readBindings } from '../src/features/shortcuts';

it('allows disjoint arrow scopes but rejects global and fixed conflicts with exact modifiers', () => {
  expect(Object.keys(defaultBindings)).toHaveLength(12);
  expect(bindingError('previous', defaultBindings.previous, defaultBindings)).toBeNull();
  expect((bindingError('play', defaultBindings.previous, defaultBindings))?.key).toBe('shortcuts.conflict');
  expect((bindingError('start', { ...defaultBindings.start, ctrl: true }, defaultBindings))?.key).toBe('shortcuts.system');
  expect(matchesBinding(new KeyboardEvent('keydown', { code: 'KeyS', shiftKey: true }), defaultBindings.start)).toBe(false);
  const custom = captureBinding(new KeyboardEvent('keydown', { code: 'KeyG', altKey: true, shiftKey: true }));
  expect(bindingError('start', custom, defaultBindings)).toBeNull();
  expect(bindingError('start', { ...custom, alt: false, meta: true }, defaultBindings)?.key).toBe('shortcuts.system');
  expect(formatBinding(custom, true)).toBe('⌥ + ⇧ + G');
  expect(formatBinding(custom, false)).toBe('Alt + Shift + G');
});
it('migrates valid old keys and rejects fixed or overlapping legacy bindings', () => {
  localStorage.clear();
  localStorage.setItem('lazulite-sync-keys', JSON.stringify({ start: 'KeyG' }));
  expect(readBindings().start.code).toBe('KeyG');
  expect(localStorage.getItem('lazulite-shortcuts')).toContain('KeyG');
  localStorage.clear();
  localStorage.setItem('lazulite-sync-keys', JSON.stringify({ start: 'Space' }));
  expect(readBindings()).toEqual(defaultBindings);
  localStorage.clear();
});
