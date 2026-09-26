import { describe, expect, it } from 'vitest';
import { createLyricDocument, lineText } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, segmentText, segmentationPreview } from '../src/domain/segmentation';

describe('E3 segmentation', () => {
  it('keeps mixed text and whitespace while applying ignore and custom rules', () => {
    const options = { ...DEFAULT_SEGMENT_OPTIONS, ignore: ['東京'], rules: [{ source: 'hello', parts: ['hel', 'lo'] }] };
    const text = '東京  hello,世界 𝄞e\u0301';
    const parts = segmentText(text, options);
    expect(parts).toEqual(['東京', '  hel', 'lo,', '世', '界', ' 𝄞e\u0301']);
    expect(parts.join('')).toBe(text);
    expect(() => segmentText('e\u0301', { ...options, rules: [{ source: 'e\u0301', parts: ['e', '\u0301'] }] })).toThrow(/字符/);
  });

  it('preserves the timed interval and undoes a multiword change once', () => {
    const document = createLyricDocument('你好 world!');
    const line = document.lines[0];
    line.beginUs = 1_000_000; line.endUs = 2_000_000;
    line.words[0].beginUs = 1_000_000; line.words[0].endUs = 2_000_000;
    const parts = segmentText(line.words[0].text, DEFAULT_SEGMENT_OPTIONS);
    const words = distributeSegmentTime(line.words[0], parts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight);
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'segment-word', lineId: line.id, wordId: line.words[0].id, words });
    expect(state.present.lines[0].words.map((word) => word.text)).toEqual(parts);
    expect(state.present.lines[0].words[0].beginUs).toBe(1_000_000);
    expect(state.present.lines[0].words.at(-1)?.endUs).toBe(2_000_000);
    expect(state.present.lines[0].words.every((word, index) => index === 0 || word.beginUs === state.present.lines[0].words[index - 1].endUs)).toBe(true);
    expect(lineText(state.present.lines[0])).toBe('你好 world!');
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('leaves an untimed Ruby word intact and merges adjacent plain words', () => {
    const document = createLyricDocument('今日も');
    const line = document.lines[0], word = line.words[0];
    word.rubyUnits.push({ id: 'r', reading: 'きょう', beginUs: null, endUs: null });
    expect(segmentationPreview(document, [word.id], DEFAULT_SEGMENT_OPTIONS)[0].blocked).toBe(true);
    expect(() => distributeSegmentTime(word, ['今', '日も'], 0.2)).toThrow(/注音/);
    word.rubyUnits = [];
    const parts = distributeSegmentTime(word, ['今日', 'も'], 0.2);
    const split = executeLyricCommand(createLyricEditorState(document), { type: 'segment-word', lineId: line.id, wordId: word.id, words: parts });
    const merged = executeLyricCommand(split, { type: 'merge-words', lineId: line.id, firstWordId: parts[0].id, secondWordId: parts[1].id });
    expect(merged.present.lines[0].words).toHaveLength(1);
    expect(merged.present.lines[0].words[0].text).toBe('今日も');
  });
});
