import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createWord, createLyricDocument } from '../../domain/lyric-document';
import { RubyGenerationDialog } from './RubyGenerationDialog';

afterEach(cleanup);

it('automatically extends time in one command without confirmation', () => {
  const lyric = createLyricDocument('粉');
  const line = lyric.lines[0];
  line.beginUs = 1_000_000; line.endUs = 2_000_000;
  line.words[0].beginUs = 1_000_000; line.words[0].endUs = 2_000_000;
  lyric.romanizationTracks.push({ id: 'latin', language: 'ja-Latn', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [
    { id: 'ko', text: 'ko', beginUs: 999_000, endUs: 2_000_000 },
  ] }] });
  const apply = vi.fn((_command: LyricCommand) => true);
  const close = vi.fn();
  const { rerender } = render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={close} />);
  expect(screen.queryByText(/时间包络扩展/)).toBeNull();
  const submit = screen.getByRole('button', { name: '生成 Ruby' });
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
  expect(screen.getByRole('button', { name: '生成 Ruby' })).toBeDisabled();
});

it('P4 default skips are visible, false overrides persist, output resets and all skipped creates no command', () => {
  const lyric = createLyricDocument('が');
  const line = lyric.lines[0];
  line.beginUs = 0; line.endUs = 1_000_000;
  line.words[0].beginUs = 0; line.words[0].endUs = 1_000_000;
  lyric.romanizationTracks.push({ id: 'latin', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [{ id: 'ga', text: 'ga', beginUs: 0, endUs: 1_000_000 }] }] });
  const apply = vi.fn(() => true);
  const { rerender } = render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  const skip = screen.getByLabelText('跳过生成');
  const submit = screen.getByRole('button', { name: '生成 Ruby' });
  expect(skip).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('所有单元均跳过');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(submit);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(skip);
  rerender(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  expect(skip).not.toBeChecked();
  expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText('目标 Ruby'), { target: { value: 'か' } });
  expect(skip).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('字符输出'), { target: { value: 'katakana' } });
  expect(skip).not.toBeChecked();
  expect(screen.getByLabelText('目标 Ruby')).toHaveValue('ガ');
  fireEvent.change(screen.getByLabelText('字符输出'), { target: { value: 'hiragana' } });
  expect(skip).toBeChecked();
  fireEvent.click(skip);
  fireEvent.click(submit);
  expect(apply).toHaveBeenCalledOnce();
});

it('P4 target changes clear only affected groups and regroup defaults before skipping', () => {
  const lyric = createLyricDocument('合成'), line = lyric.lines[0];
  line.beginUs = 0; line.endUs = 3_000_000;
  line.words = ['が', 'な', 'か'].map((text, i) => ({ ...createWord(text), beginUs: i * 1_000_000, endUs: (i + 1) * 1_000_000 }));
  lyric.romanizationTracks.push({ id: 'track', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed',
    units: ['ga', 'na', 'ka'].map((text, i) => ({ id: 'u' + i, text, beginUs: i * 1_000_000, endUs: (i + 1) * 1_000_000 })) }] });
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
    { id: 'empty', text: '', beginUs: 0, endUs: 1_000_000 }, { id: 'space', text: '　 ', beginUs: 0, endUs: 1_000_000 },
  ] }] }];
  const apply = vi.fn();
  render(<RubyGenerationDialog document={lyric} lineIds={[line.id]} apply={apply} close={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('没有可生成的音译单元');
  expect(screen.queryByText('空单元')).toBeNull();
  expect(screen.getByRole('button', { name: '生成 Ruby' })).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});
