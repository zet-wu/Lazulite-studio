import { expect, it } from 'vitest';
import { COLUMN_DEFAULTS, COLUMN_STORAGE, readColumnPreferences, renderedColumns } from '../src/features/editor/column-preferences';
it('resets malformed preferences and constrains rendering without mutating stored widths', () => {
  for (const raw of ['{', 'null', JSON.stringify({ ...COLUMN_DEFAULTS, inspectorWidth: 900 })]) {
    localStorage.setItem(COLUMN_STORAGE, raw);
    expect(readColumnPreferences()).toEqual(COLUMN_DEFAULTS);
  }
  const preference = { ...COLUMN_DEFAULTS, outlineWidth: 360, inspectorWidth: 420 };
  const snapshot = { ...preference };
  expect(renderedColumns(preference, 852)).toEqual({ outline: 160, inspector: 200 });
  expect(preference).toEqual(snapshot);
  expect(renderedColumns({ ...preference, outlineVisible: false, inspectorVisible: false }, 600)).toEqual({ outline: 0, inspector: 0 });
  localStorage.removeItem(COLUMN_STORAGE);
});
