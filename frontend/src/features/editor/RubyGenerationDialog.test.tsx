import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createWord, createLyricDocument } from '../../domain/lyric-document';
import { RubyGenerationDialog } from './RubyGenerationDialog';

afterEach(cleanup);

it('automatically extends time in one command without confirmation', () => {
  const lyric = createLyricDocument('粉');
  const line = lyric.lines[0];
  line.beginMs = 1000; line.endMs = 2000;
  line.words[0].beginMs = 1000; line.words[0].endMs = 2000;
  lyric.romanizationTracks.push({ id: 'latin', language: 'ja-Latn', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [
    { id: 'ko', text: 'ko', beginMs: 999, endMs: 2000 },
  ] }] });
  const apply = vi.fn((_command: LyricCommand) => true);
  const close = vi.fn();
  const { rerender } = render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={close} />);
  expect(screen.queryByText(/时间包络扩展/)).toBeNull();
  const submit = screen.getByRole('button', { name: '生成 注音' });
  expect(screen.queryByLabelText('确认同时扩展上述词/行时间')).toBeNull();
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(apply).toHaveBeenCalledOnce();
  expect(apply.mock.calls[0][0]).toMatchObject({ type: 'batch' });
  expect(close).toHaveBeenCalledOnce();
  expect(lyric.romanizationTracks[0].contents[0]).toMatchObject({ id: 'content' });

  const changed = { ...lyric };
  rerender(<RubyGenerationDialog document={changed} lineIds={[line.id]} apply={apply} close={close} />);
  expect(screen.getByText(/文档已变化/)).toBeVisible();
  expect(screen.getByRole('button', { name: '生成 注音' })).toBeDisabled();
});

it('P4 default skips are visible, false overrides persist, output resets and all skipped creates no command', () => {
  const lyric = createLyricDocument('が');
  const line = lyric.lines[0];
  line.beginMs = 0; line.endMs = 1000;
  line.words[0].beginMs = 0; line.words[0].endMs = 1000;
  lyric.romanizationTracks.push({ id: 'latin', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [{ id: 'ga', text: 'ga', beginMs: 0, endMs: 1000 }] }] });
  const apply = vi.fn(() => true);
  const { rerender } = render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  const skip = screen.getByLabelText('跳过生成');
  const submit = screen.getByRole('button', { name: '生成 注音' });
  expect(skip).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('所有单元均跳过');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(submit);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(skip);
  rerender(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  expect(skip).not.toBeChecked();
  expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText('目标 注音'), { target: { value: 'か' } });
  expect(skip).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('字符输出'), { target: { value: 'katakana' } });
  expect(skip).not.toBeChecked();
  expect(screen.getByLabelText('目标 注音')).toHaveValue('ガ');
  fireEvent.change(screen.getByLabelText('字符输出'), { target: { value: 'hiragana' } });
  expect(skip).toBeChecked();
  fireEvent.click(skip);
  fireEvent.click(submit);
  expect(apply).toHaveBeenCalledOnce();
});

it('P4 target changes clear only affected groups and regroup defaults before skipping', () => {
  const lyric = createLyricDocument('合成'), line = lyric.lines[0];
  line.beginMs = 0; line.endMs = 3000;
  line.words = ['が', 'な', 'か'].map((text, i) => ({ ...createWord(text), beginMs: i * 1000, endMs: (i + 1) * 1000 }));
  lyric.romanizationTracks.push({ id: 'track', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed',
    units: ['ga', 'na', 'ka'].map((text, i) => ({ id: 'u' + i, text, beginMs: i * 1000, endMs: (i + 1) * 1000 })) }] });
  const apply = vi.fn(() => true);
  render(<RubyGenerationDialog document={lyric} lineIds={lyric.lines.map(line => line.id)} apply={apply} close={vi.fn()} />);
  const skips = screen.getAllByLabelText('跳过生成');
  skips.forEach(skip => fireEvent.click(skip));
  const targets = screen.getAllByLabelText('目标词');
  fireEvent.change(targets[0], { target: { value: line.words[1].id } });
  expect(skips[0]).not.toBeChecked();
  expect(skips[1]).not.toBeChecked();
  fireEvent.change(targets[0], { target: { value: lyric.lines[0].words[0].id } });
  expect(skips[0]).toBeChecked();
  expect(skips[1]).toBeChecked();
  expect(skips[2]).not.toBeChecked();
});

it('shows a compact empty state without proposal rows or an enabled submit for whitespace sources', () => {
  const lyric = createLyricDocument('歌'), line = lyric.lines[0];
  lyric.romanizationTracks = [{ id: 'track', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
    { id: 'empty', text: '', beginMs: 0, endMs: 1000 }, { id: 'space', text: '　 ', beginMs: 0, endMs: 1000 },
  ] }] }];
  const apply = vi.fn();
  render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('没有可生成的音译单元');
  expect(screen.queryByText('空单元')).toBeNull();
  expect(screen.getByRole('button', { name: '生成 注音' })).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});

it('counts only selected contents with nonempty source rows as tracks and content checks change', () => {
  const lyric = createLyricDocument('歌');
  lyric.lines.push({ ...lyric.lines[0], id: 'second', words: [createWord('雪')] });
  lyric.lines.push({ ...lyric.lines[0], id: 'third', words: [createWord('雨')] });
  lyric.romanizationTracks = [{ id: 'a', language: 'en', contents: [
    { id: 'c1', lineId: lyric.lines[0].id, kind: 'plain', text: 'uta' },
    { id: 'c2', lineId: 'second', kind: 'plain', text: 'yuki' },
  ] }, { id: 'b', language: 'ja', contents: [{ id: 'c3', lineId: 'third', kind: 'plain', text: 'ame' }] }];
  render(<RubyGenerationDialog document={lyric} lineIds={lyric.lines.map(line => line.id)} apply={vi.fn()} close={vi.fn()} />);
  expect(screen.getByText('生成 2 / 3 行')).toBeVisible();
  fireEvent.click(screen.getByText('音译内容', { selector: 'summary' }));
  fireEvent.click(screen.getByLabelText(/L2 · yuki/));
  expect(screen.getByText('生成 1 / 3 行')).toBeVisible();
  fireEvent.change(screen.getByLabelText('音译轨道'), { target: { value: 'b' } });
  expect(screen.getByText('生成 1 / 3 行')).toBeVisible();
  fireEvent.click(screen.getByLabelText(/L3 · ame/));
  expect(screen.getByText('生成 0 / 3 行')).toBeVisible();
  expect(screen.getByRole('button', { name: '生成 注音' })).toBeDisabled();
});

it('blocks stale proposals and refreshes explicitly without applying old edits', () => {
  const document = createLyricDocument('は'), line = document.lines[0];
  Object.assign(line.words[0], { beginMs: 0, endMs: 1000 });
  document.romanizationTracks = [{ id: 't', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed',
    units: [{ id: 'u', text: 'ka', beginMs: 0, endMs: 1000 }] }] }];
  const props = { document, lineIds: [line.id], apply: vi.fn(() => true), close: vi.fn() };
  const view = render(<RubyGenerationDialog {...props} />);
  fireEvent.change(screen.getByLabelText('目标 注音'), { target: { value: 'わ' } });
  view.rerender(<RubyGenerationDialog {...props} document={{ ...document }} />);
  expect(screen.getByRole('button', { name: '下一处错误／警告' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '生成 注音' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /核对 ·/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新生成提案' }));
  expect(screen.getByLabelText('目标 注音')).toHaveValue('か');
  expect(props.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(props.close).toHaveBeenCalledOnce();
});
