import { message, MessageError } from './messages';
/** DOM offsets are UTF-16; editing commands use code points and permit grapheme boundaries only. */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function codePointToUtf16(text: string, index: number): number {
  const points = Array.from(text);
  if (!Number.isSafeInteger(index) || index < 0 || index > points.length) throw new MessageError(message('text.codePointOffset'));
  return points.slice(0, index).join('').length;
}

export function utf16ToCodePoint(text: string, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new MessageError(message('text.utf16Offset'));
  const prefix = text.slice(0, offset);
  if (prefix.length && /[\uD800-\uDBFF]$/.test(prefix) && /^[\uDC00-\uDFFF]/.test(text.slice(offset))) throw new MessageError(message('text.surrogateSplit'));
  return Array.from(prefix).length;
}

export function isGraphemeBoundary(text: string, pointOffset: number): boolean {
  const offset = codePointToUtf16(text, pointOffset);
  return offset === 0 || offset === text.length || Array.from(graphemes.segment(text), (part) => part.index).includes(offset);
}

export function splitAtGrapheme(text: string, pointOffset: number): [string, string] {
  if (!isGraphemeBoundary(text, pointOffset) || pointOffset === 0 || pointOffset === Array.from(text).length) throw new MessageError(message('text.graphemeSplit'));
  const offset = codePointToUtf16(text, pointOffset);
  return [text.slice(0, offset), text.slice(offset)];
}
