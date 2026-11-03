import { message } from '../domain/messages';
import { preferences } from '../adapters/preferences';
import { useEffect, useState } from 'react';

export const shortcutActions = {
  start: ['shortcuts.timing', 'sync.start', 'KeyS'], next: ['shortcuts.timing', 'sync.step', 'KeyD'], end: ['shortcuts.timing', 'sync.end', 'KeyF'],
  previous: ['shortcuts.timing', 'sync.previousUnit', 'ArrowLeft'], following: ['shortcuts.timing', 'sync.nextUnit', 'ArrowRight'],
  previousLine: ['shortcuts.timing', 'sync.previousLine', 'ArrowUp'], followingLine: ['shortcuts.timing', 'sync.nextLine', 'ArrowDown'],
  play: ['shortcuts.playback', 'shortcuts.toggle', 'Space'],
  seekBack: ['shortcuts.seek', 'shortcuts.back', 'ArrowLeft'], seekForward: ['shortcuts.seek', 'shortcuts.forward', 'ArrowRight'],
  seekStart: ['shortcuts.seek', 'shortcuts.begin', 'Home'], seekEnd: ['shortcuts.seek', 'shortcuts.end', 'End'],
} as const;
export type ShortcutAction = keyof typeof shortcutActions;
export type Binding = { code: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
export type Bindings = Record<ShortcutAction, Binding>;
const storageKey = 'lazulite-shortcuts';
const plain = (code: string): Binding => ({ code, ctrl: false, meta: false, alt: false, shift: false });
export const defaultBindings = Object.fromEntries(Object.entries(shortcutActions).map(([key, value]) => [key, plain(value[2])])) as Bindings;
export function captureBinding(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): Binding {
  return { code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey };
}
export function matchesBinding(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, binding: Binding) {
  return event.code === binding.code && event.ctrlKey === binding.ctrl && event.metaKey === binding.meta && event.altKey === binding.alt && event.shiftKey === binding.shift;
}
const same = (a: Binding, b: Binding) => a.code === b.code && a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift;
export function bindingError(action: ShortcutAction, binding: Binding, bindings: Bindings): import('../domain/messages').Message | null {
  if (!/^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Home|End|Space|F[1-9][0-9]?|Numpad[0-9])$/.test(binding.code)) return message('shortcuts.reserved');
  if (/^F/.test(binding.code) || (binding.alt && (/^Arrow/.test(binding.code) || binding.code === 'Space')) ||
    ((binding.ctrl || binding.meta) && /^(Key[ACVXSZYWLNTRPQHJKOFDBEGUIM]|Digit[0-9]|Space|Arrow.*|Home|End)$/.test(binding.code)) ||
    (binding.ctrl && binding.alt)) return message('shortcuts.system');
  const scope = shortcutActions[action][0];
  for (const other of Object.keys(shortcutActions) as ShortcutAction[]) {
    if (other === action) continue;
    const otherScope = shortcutActions[other][0];
    if ((scope === otherScope || scope === 'shortcuts.playback' || otherScope === 'shortcuts.playback') && same(binding, bindings[other])) return {key:'shortcuts.conflict',values:{actionKey:shortcutActions[other][1]}};
  }
  return null;
}
export function readBindings(): Bindings {
  let value: unknown;
  try { value = JSON.parse(preferences.getItem(storageKey) ?? 'null'); } catch { value = null; }
  const result = { ...defaultBindings };
  if (value && typeof value === 'object') {
    const candidate = { ...result, ...value } as Bindings;
    for (const action of Object.keys(shortcutActions) as ShortcutAction[]) {
      const binding = candidate[action];
      if (!binding || typeof binding.code !== 'string' || !['ctrl', 'meta', 'alt', 'shift'].every(key => typeof binding[key as keyof Binding] === 'boolean')) return result;
    }
    if ((Object.keys(shortcutActions) as ShortcutAction[]).some(action => bindingError(action, candidate[action], candidate))) return result;
    return candidate;
  }
  return result;
}
export function saveBindings(bindings: Bindings) {
  preferences.setItem(storageKey, JSON.stringify(bindings));
  window.dispatchEvent(new Event('studio-shortcuts-change'));
}
export function useShortcuts() {
  const [bindings, setBindings] = useState(readBindings);
  useEffect(() => {
    const update = () => setBindings(readBindings());
    window.addEventListener('storage', update); window.addEventListener('studio-shortcuts-change', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('studio-shortcuts-change', update); };
  }, []);
  return bindings;
}
export function formatBinding(binding: Binding, mac = /Mac/.test(navigator.platform)) {
  const names: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space' };
  return [binding.ctrl && (mac ? '⌃' : 'Ctrl'), binding.meta && (mac ? '⌘' : 'Win'), binding.alt && (mac ? '⌥' : 'Alt'), binding.shift && (mac ? '⇧' : 'Shift'), names[binding.code] ?? binding.code.replace(/^Key|^Digit/, '')].filter(Boolean).join(' + ');
}
export function shortcutInput(target: EventTarget | null, code?: string) {
  if (document.querySelector('[role="dialog"], [role="menu"], details[data-top-menu][open]')) return true;
  // Buttons retain focus after a mouse click. Only their native activation keys
  // take precedence over timing shortcuts; editable and composite controls always do.
  if (target instanceof Element && target.closest('button') && (!code || code === 'Space' || code === 'Enter')) return true;
  return target instanceof Element && Boolean(target.closest('input, textarea, select, a, summary, [contenteditable="true"], [role="dialog"], [role="menu"], [role="separator"], [data-top-menu]'));
}
