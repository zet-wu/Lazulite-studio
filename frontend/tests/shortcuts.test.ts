import { expect, it } from 'vitest';
import { bindingError, captureBinding, defaultBindings, formatBinding, matchesBinding } from '../src/features/shortcuts';

it('allows disjoint arrow scopes but rejects global and fixed conflicts with exact modifiers', () => {
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
