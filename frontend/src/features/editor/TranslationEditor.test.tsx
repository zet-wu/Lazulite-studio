import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TranslationEditor } from './TranslationEditor';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps new and invalid language drafts local, commits valid input and exposes an accessible trash button', () => {
  const apply = vi.fn(() => true);
  render(<TranslationEditor items={[]} apply={apply} />);
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  const text = screen.getByLabelText('翻译 1'), language = screen.getByLabelText('翻译 1语言');
  fireEvent.change(language, { target: { value: 'en' } }); fireEvent.blur(language);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(text, { target: { value: 'song' } });
  fireEvent.change(language, { target: { value: 'en_US' } }); fireEvent.blur(language);
  expect(screen.getByRole('alert')).toHaveTextContent('语言标签格式无效');
  expect(language).toHaveValue('en_US'); expect(apply).not.toHaveBeenCalled();
  fireEvent.change(language, { target: { value: 'zh-Hans' } }); fireEvent.blur(language);
  expect(apply).toHaveBeenCalledExactlyOnceWith([{ language: 'zh-Hans', text: 'song' }]);
});

it('clears and deletes only the requested translation', () => {
  const apply = vi.fn(() => true), items = [{ text: 'first', language: 'en' }, { text: 'second', language: null }];
  render(<TranslationEditor items={items} apply={apply} />);
  fireEvent.change(screen.getByLabelText('翻译 1'), { target: { value: '' } }); fireEvent.blur(screen.getByLabelText('翻译 1'));
  expect(apply).toHaveBeenLastCalledWith([{ ...items[0], text: '' }, items[1]]);
  fireEvent.click(screen.getAllByRole('button', { name: '删除翻译' })[1]);
  expect(apply).toHaveBeenLastCalledWith([items[0]]);
});
