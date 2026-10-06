import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine, createWord } from '../../domain/lyric-document';
import { LineSplitDialog } from './LineSplitDialog';
afterEach(cleanup);
it('previews multiple cuts and requires reassignment when a background segment disappears', () => {
  const line = createLine(''); line.words = [0, 1, 2, 3].map(i => createWord(`${i}`, `w${i}`));
  const submit = vi.fn(() => true);
  render(<LineSplitDialog line={line} translations={[]} attached={[]} background={createLine('背景')} close={() => {}} submit={submit} />);
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '在第 4 词前切分' }));
  fireEvent.click(screen.getByRole('button', { name: '在第 2 词前切分' }));
  expect(screen.getByLabelText('拆分结果').querySelectorAll('section')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '在第 4 词前切分' }));
  expect(screen.getByRole('alert')).toHaveTextContent('重新选择');
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});

it('defaults background to the last of three results while adding boundaries', () => {
  const line = createLine(''); line.words = [0, 1, 2, 3].map(i => createWord(`${i}`, `w${i}`));
  const submit = vi.fn(() => true);
  render(<LineSplitDialog line={line} translations={[]} attached={[]} background={createLine('背景')} close={() => {}} submit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: '在第 2 词前切分' }));
  fireEvent.click(screen.getByRole('button', { name: '在第 4 词前切分' }));
  expect(screen.getByLabelText('拆分结果').querySelectorAll('section')[2]).toHaveTextContent('背景');
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ backgroundTarget: 2 }));
});
