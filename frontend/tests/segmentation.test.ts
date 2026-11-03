import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord, lineText } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from './helpers/project-history';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, loadSyllableDivider, segmentText, segmentationPreview } from '../src/domain/segmentation';

describe('E3 segmentation', () => {
  it('keeps mixed text and whitespace while applying ignore and custom rules', () => {
    const options = { ...DEFAULT_SEGMENT_OPTIONS, ignore: ['東京'], rules: [{ source: 'hello', parts: ['hel', 'lo'] }] };
    const text = '東京  hello,世界 𝄞e\u0301';
    const parts = segmentText(text, options);
    expect(parts).toEqual(['東京', '  ', 'hel', 'lo,', '世', '界', ' ', '𝄞', 'e\u0301']);
    expect(parts.join('')).toBe(text);
    expect(() => segmentText('e\u0301', { ...options, rules: [{ source: 'e\u0301', parts: ['e', '\u0301'] }] })).toThrow('segment.ruleCharacter');
  });

  it('loads a real language pattern and keeps the western word intact across syllables', async () => {
    const divide = await loadSyllableDivider('en-us');
    const parts = segmentText('internationalization', { ...DEFAULT_SEGMENT_OPTIONS, western: 'syllable' }, divide);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe('internationalization');
  });

  it('preserves the timed interval and undoes a multiword change once', () => {
    const document = createLyricDocument('你好 world!');
    const line = document.lines[0];
    line.beginMs = 1000; line.endMs = 2000;
    line.words[0].beginMs = 1000; line.words[0].endMs = 2000;
    const parts = segmentText(line.words[0].text, DEFAULT_SEGMENT_OPTIONS);
    const words = distributeSegmentTime(line.words[0], parts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight);
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'segment-word', lineId: line.id, wordId: line.words[0].id, words });
    expect(state.present.lines[0].words.map((word) => word.text)).toEqual(parts);
    expect(state.present.lines[0].words[0].beginMs).toBe(1000);
    expect(state.present.lines[0].words.at(-1)?.endMs).toBe(2000);
    expect(state.present.lines[0].words.every((word, index) => index === 0 || word.beginMs === state.present.lines[0].words[index - 1].endMs)).toBe(true);
    expect(lineText(state.present.lines[0])).toBe('你好 world!');
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('keeps known endpoints on a partly untimed word and preserves repeated spaces', () => {
    const document = createLyricDocument('a  b');
    const word = document.lines[0].words[0];
    word.beginMs = 500;
    const parts = segmentText(word.text, { ...DEFAULT_SEGMENT_OPTIONS, whitespace: 'separate', punctuation: 'separate' });
    expect(parts).toEqual(['a', '  ', 'b']);
    const words = distributeSegmentTime(word, parts, 0.2);
    expect(words.map((item) => [item.beginMs, item.endMs])).toEqual([[500, null], [null, null], [null, null]]);
    word.beginMs = null; word.endMs = 900;
    expect(distributeSegmentTime(word, parts, 0.2).map((item) => [item.beginMs, item.endMs])).toEqual([[null, null], [null, null], [null, 900]]);
  });

  it('leaves an untimed 注音 word intact and merges adjacent plain words', () => {
    const document = createLyricDocument('今日も');
    const line = document.lines[0], word = line.words[0];
    word.rubyUnits.push({ id: 'r', reading: 'きょう', beginMs: null, endMs: null });
    expect(segmentationPreview(document, [word.id], DEFAULT_SEGMENT_OPTIONS)[0].blocked).toBe(true);
    expect(() => distributeSegmentTime(word, ['今', '日も'], 0.2)).toThrow('segment.wordAttributes');
    word.rubyUnits = [];
    const parts = distributeSegmentTime(word, ['今日', 'も'], 0.2);
    const split = executeLyricCommand(createLyricEditorState(document), { type: 'segment-word', lineId: line.id, wordId: word.id, words: parts });
    const merged = executeLyricCommand(split, { type: 'merge-words', wordIds: [parts[0].id, parts[1].id ] });
    expect(merged.present.lines[0].words).toHaveLength(1);
    expect(merged.present.lines[0].words[0].text).toBe('今日も');
  });

  it('applies full-document segmentation in one command across 2000 lines', () => {
    const document = createLyricDocument();
    document.lines = Array.from({ length: 2_000 }, (_, index) => {
      const line = createLine('', `line-${index}`);
      line.words = Array.from({ length: 10 }, (_, wordIndex) => createWord('中文', `word-${index}-${wordIndex}`));
      return line;
    });
    const changes = document.lines.flatMap((line) => line.words.map((word) => ({
      lineId: line.id, wordId: word.id, words: distributeSegmentTime(word, ['中', '文'], 0.2),
    })));
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'segment-words', changes });
    expect(state.present.lines).toHaveLength(2_000);
    expect(state.present.lines[0].words).toHaveLength(20);
    expect(state.present.lines[1_999].words).toHaveLength(20);
    expect(state.past).toEqual([document]);
    expect(undoLyricCommand(state).present).toBe(document);
  });
});

it('keeps CJK variation selectors, combining marks and emoji sequences whole in the default shortcut', () => {
  const text = '葛\u{E0100}飾 e\u0301 👩‍👩‍👧‍👦', parts = segmentText(text, DEFAULT_SEGMENT_OPTIONS);
  expect(parts[0]).toBe('葛\u{E0100}');
  expect(parts.join('')).toBe(text);
  expect(parts.some(part => part.includes('e\u0301'))).toBe(true);
  expect(parts.some(part => part.includes('👩‍👩‍👧‍👦'))).toBe(true);
});

it('defaults to independent whitespace words for western lyrics, including punctuation after spaces', () => {
  expect(segmentText('I still love you', DEFAULT_SEGMENT_OPTIONS)).toEqual(['I', ' ', 'still', ' ', 'love', ' ', 'you']);
  expect(segmentText('a  , b', DEFAULT_SEGMENT_OPTIONS)).toEqual(['a', '  ', ',', ' ', 'b']);
});

it('automatically previews current parameters, waits for IME, and applies the displayed split', async () => {
  const {createElement} = await import('react');
  const {render, screen, fireEvent, waitFor, cleanup} = await import('@testing-library/react');
  const {SegmentationPanel} = await import('../src/features/editor/SegmentationPanel');
  const document = createLyricDocument('hello');
  const applied: unknown[] = [];
  const view = render(createElement(SegmentationPanel, {document, selection:null, currentLineId:document.lines[0].id, apply:command=>{applied.push(command);return true;}, close:()=>{}}));
  try {
    fireEvent.click(screen.getByRole('button', {name:'高级'}));
    const rules = screen.getByLabelText('自定义规则（每行 原文=部分|部分）');
    const apply = screen.getByRole('button', {name:'应用（一次撤销）'});
    fireEvent.change(rules, {target:{value:'hello=hel|lo'}});
    await waitFor(()=>expect(apply).toBeEnabled());
    fireEvent.compositionStart(rules);
    fireEvent.change(rules,{target:{value:'hello=he|llo'}});
    expect(apply).toBeDisabled();
    fireEvent.compositionEnd(rules);
    await waitFor(()=>expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(applied).toMatchObject([{type:'segment-words',changes:[{words:[{text:'he'},{text:'llo'}]}]}]);
    fireEvent.change(rules,{target:{value:'invalid'}});
    expect(apply).toBeDisabled();
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('invalid'));
  } finally {view.unmount();cleanup();}
});

it('ignores late syllable previews after newer inputs and after closing', async () => {
  const {createElement} = await import('react');
  const {render, screen, fireEvent, waitFor, act, cleanup} = await import('@testing-library/react');
  const {vi} = await import('vitest');
  const segmentation = await import('../src/domain/segmentation');
  const pending: Array<(divide:(text:string)=>string[])=>void> = [];
  const loader = vi.spyOn(segmentation, 'loadSyllableDivider').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const {SegmentationPanel} = await import('../src/features/editor/SegmentationPanel');
  const document = createLyricDocument('hello'), apply = vi.fn(()=>true);
  const view = render(createElement(SegmentationPanel, {document, selection:null, currentLineId:document.lines[0].id, apply, close:()=>{}}));
  try {
    fireEvent.click(screen.getByRole('button',{name:'自动'}));
    fireEvent.change(screen.getByLabelText('西文处理'),{target:{value:'syllable'}});
    await waitFor(()=>expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('音节语言'),{target:{value:'de'}});
    expect(screen.getByRole('button',{name:'应用（一次撤销）'})).toBeDisabled();
    await waitFor(()=>expect(pending).toHaveLength(2));
    await act(async()=>pending[1](()=>['he','llo']));
    await act(async()=>pending[0](()=>['hel','lo']));
    fireEvent.click(screen.getByRole('button',{name:'应用（一次撤销）'}));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({changes:[expect.objectContaining({words:[expect.objectContaining({text:'he'}),expect.objectContaining({text:'llo'})]})]}));
    fireEvent.change(screen.getByLabelText('音节语言'),{target:{value:'fr'}});
    await waitFor(()=>expect(pending).toHaveLength(3));
    view.unmount();
    await act(async()=>pending[2](()=>['h','ello']));
    expect(apply).toHaveBeenCalledTimes(1);
  } finally {view.unmount();loader.mockRestore();cleanup();}
});
