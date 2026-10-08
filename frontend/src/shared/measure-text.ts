// Measure in CSS pixels using the rendered font, including mixed-width text.
export function measureTextWidth(element: HTMLElement, text: string, input = false) {
  const style = getComputedStyle(element);
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return 0;
  context.font = style.font;
  const spacing = parseFloat(style.letterSpacing) || 0;
  const width = Math.max(0, ...text.split('\n').map(line => context.measureText(line).width + Math.max(0, Array.from(line).length - 1) * spacing));
  const inset = input ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, key) => sum + (parseFloat(style[key as keyof CSSStyleDeclaration] as string) || 0), 0) + 4 : 0;
  return Math.ceil(width + inset);
}
