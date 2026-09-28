export type ColumnPreferences = { outlineVisible: boolean; inspectorVisible: boolean; outlineWidth: number; inspectorWidth: number };
export const COLUMN_STORAGE = 'lazulite-editor-columns';
export const COLUMN_DEFAULTS: ColumnPreferences = { outlineVisible: true, inspectorVisible: true, outlineWidth: 190, inspectorWidth: 250 };
export const COLUMN_LIMITS = { outline: { min: 160, max: 360, default: 190 }, inspector: { min: 200, max: 420, default: 250 } };
export type ColumnSide = keyof typeof COLUMN_LIMITS;

export function readColumnPreferences(): ColumnPreferences {
  const raw = localStorage.getItem(COLUMN_STORAGE);
  if (!raw) return { ...COLUMN_DEFAULTS };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ...COLUMN_DEFAULTS }; }
  const item = value as Partial<ColumnPreferences> | null;
  if (!item || typeof item.outlineVisible !== 'boolean' || typeof item.inspectorVisible !== 'boolean' ||
    typeof item.outlineWidth !== 'number' || !Number.isFinite(item.outlineWidth) || item.outlineWidth < 160 || item.outlineWidth > 360 ||
    typeof item.inspectorWidth !== 'number' || !Number.isFinite(item.inspectorWidth) || item.inspectorWidth < 200 || item.inspectorWidth > 420) return { ...COLUMN_DEFAULTS };
  return { outlineVisible: item.outlineVisible, inspectorVisible: item.inspectorVisible, outlineWidth: item.outlineWidth, inspectorWidth: item.inspectorWidth };
}

/** Render constraints never overwrite the saved preferred widths. */
export function renderedColumns(preferences: ColumnPreferences, available: number) {
  let outline = preferences.outlineVisible ? preferences.outlineWidth : 0;
  let inspector = preferences.inspectorVisible ? preferences.inspectorWidth : 0;
  const separators = (Number(preferences.outlineVisible) + Number(preferences.inspectorVisible)) * 6;
  const outlineSlack = outline ? outline - COLUMN_LIMITS.outline.min : 0;
  const inspectorSlack = inspector ? inspector - COLUMN_LIMITS.inspector.min : 0;
  const slack = outlineSlack + inspectorSlack;
  const reduction = Math.min(slack, Math.max(0, outline + inspector + separators + 480 - available));
  if (slack > 0) { outline -= reduction * outlineSlack / slack; inspector -= reduction * inspectorSlack / slack; }
  return { outline, inspector };
}
