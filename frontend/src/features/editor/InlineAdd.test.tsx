import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineAdd } from './InlineAdd';
afterEach(cleanup);

it('keeps IME drafts through mouseleave, submits once on Enter/blur and cancels empty or escaped drafts', () => {
  const commit = vi.fn(() => true);
  render(<InlineAdd label="添加词" commit={commit} />);
  fireEvent.click(screen.getByRole('button'));
  let input = screen.getByRole('textbox'); expect(input).toHaveFocus();
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '中文' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.mouseLeave(input);
  expect(commit).not.toHaveBeenCalled(); expect(input).toHaveValue('中文');
  fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
  expect(commit).toHaveBeenCalledExactlyOnceWith('中文');
  fireEvent.click(screen.getByRole('button')); input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'cancel' } }); fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.blur(input);
  expect(commit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button')); input = screen.getByRole('textbox');
  fireEvent.blur(input);
  expect(screen.queryByRole('textbox')).toBeNull(); expect(commit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button')); input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: ' next ' } }); fireEvent.blur(input);
  expect(commit).toHaveBeenLastCalledWith(' next ');
  fireEvent.click(screen.getByRole('button')); input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '　 ' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(commit).toHaveBeenLastCalledWith('　 ');
});

it('retains failed input and permits retry without creating a second object', () => {
  const commit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  render(<InlineAdd label="添加词" commit={commit} />);
  fireEvent.click(screen.getByRole('button'));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: ' retained ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue(' retained '); expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(commit).toHaveBeenCalledTimes(2); expect(screen.queryByRole('textbox')).toBeNull();
});
