import { preferences } from '../adapters/preferences';
import { useEffect, useState } from 'react';

export const shortcutActions = {
  start: ['打轴', '起始轴', 'KeyS'], next: ['打轴', '连续轴', 'KeyD'], end: ['打轴', '结束轴', 'KeyF'],
  previous: ['打轴', '上一单元', 'ArrowLeft'], following: ['打轴', '下一单元', 'ArrowRight'],
  previousLine: ['打轴', '上一行', 'ArrowUp'], followingLine: ['打轴', '下一行', 'ArrowDown'],
  play: ['播放', '播放 / 暂停', 'Space'],
  seekBack: ['播放定位', '后退 1 秒', 'ArrowLeft'], seekForward: ['播放定位', '前进 1 秒', 'ArrowRight'],
  seekStart: ['播放定位', '定位媒体起点', 'Home'], seekEnd: ['播放定位', '定位媒体终点', 'End'],
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
export function bindingError(action: ShortcutAction, binding: Binding, bindings: Bindings): string | null {
  if (!/^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Home|End|Space|F[1-9][0-9]?|Numpad[0-9])$/.test(binding.code)) return '此按键保留给文本或控件操作';
  if (/^F/.test(binding.code) || (binding.alt && (/^Arrow/.test(binding.code) || binding.code === 'Space')) ||
    ((binding.ctrl || binding.meta) && /^(Key[ACVXSZYWLNTRPQHJKOFDBEGUIM]|Digit[0-9]|Space|Arrow.*|Home|End)$/.test(binding.code)) ||
    (binding.ctrl && binding.alt)) return '此组合键用于固定操作或系统/浏览器，不能可靠接管';
  const scope = shortcutActions[action][0];
  for (const other of Object.keys(shortcutActions) as ShortcutAction[]) {
    if (other === action) continue;
    const otherScope = shortcutActions[other][0];
    if ((scope === otherScope || scope === '播放' || otherScope === '播放') && same(binding, bindings[other])) return `与“${shortcutActions[other][1]}”冲突`;
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
  try {
    const old = JSON.parse(preferences.getItem('lazulite-sync-keys') ?? 'null') as Record<string, unknown> | null;
    if (old) {
      const candidate = { ...result };
      for (const action of Object.keys(shortcutActions) as ShortcutAction[]) if (typeof old[action] === 'string' && shortcutActions[action][0] === '打轴') candidate[action] = plain(old[action]);
      if ((Object.keys(shortcutActions) as ShortcutAction[]).every(action => !bindingError(action, candidate[action], candidate))) {
        preferences.setItem(storageKey, JSON.stringify(candidate));
        return candidate;
      }
    }
  } catch { /* Invalid persisted preferences are discarded at the storage boundary. */ }
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
