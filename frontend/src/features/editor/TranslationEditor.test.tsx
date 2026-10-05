import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLyricDocument, plainTranslation } from '../../domain/lyric-document';
import { TranslationEditor } from './TranslationEditor';
import { TranslationTrackDialog } from './TranslationTrackDialog';
import { applyLyricCommand } from '../../domain/lyric-commands';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('requires an explicit track and submits text without local language overrides', () => {
  const document = createLyricDocument('行'), apply = vi.fn(() => true);
  document.translationTracks = [{ id: 'a', language: 'en', purpose: 'subtitle', contents: [] }];
  render(<TranslationEditor document={document} lineId={document.lines[0].id} apply={apply} manage={vi.fn()} />);
  expect(screen.getByRole('button', { name: '添加' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('新增翻译的轨道'), { target: { value: 'a' } });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  const text = screen.getByLabelText('翻译 1'); fireEvent.change(text, { target: { value: ' song ' } }); fireEvent.blur(text);
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ type: 'insert-translation-content', trackId: 'a', content: expect.objectContaining({ text: ' song ', lineId: document.lines[0].id }) }));
});
it('applies active metadata edits once, validates language and blocks stale document proposals', () => {
  const document = createLyricDocument('行'); document.translationTracks = [{ id: 'a', language: 'en', purpose: 'subtitle', contents: [plainTranslation('text', document.lines[0].id)] }];
  const apply = vi.fn(command => { applyLyricCommand(document, command); return true; });
  const props = { document, apply, close: vi.fn() }; const view = render(<TranslationTrackDialog {...props} />);
  fireEvent.change(screen.getByLabelText('翻译轨道 1语言'), { target: { value: 'en_US' } });
  fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(screen.getByRole('alert')).toHaveTextContent('语言标签');
  fireEvent.change(screen.getByLabelText('翻译轨道 1语言'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(props.close).toHaveBeenCalledOnce();
  expect(apply.mock.calls.at(-1)![0].tracks[0].language).toBeNull();
  view.rerender(<TranslationTrackDialog {...props} document={{ ...document }} />);
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
});
it('deletes immediately in the draft, clears target and selection, and allows cancelling without application', () => {
  const document = createLyricDocument('行'); const content = plainTranslation('text', document.lines[0].id);
  document.translationTracks = [{ id: 'a', language: 'en', purpose: 'subtitle', contents: [content] }];
  const apply = vi.fn(() => true), close = vi.fn(); render(<TranslationTrackDialog document={document} apply={apply} close={close} />);
  fireEvent.click(screen.getByLabelText(`选择翻译内容 ${content.id}`));
  fireEvent.change(screen.getByLabelText('翻译归轨目标'), { target: { value: 'a' } });
  fireEvent.click(screen.getByRole('button', { name: '删除轨道及 1 份内容（轨道 1）' }));
  expect(screen.getByLabelText('翻译归轨目标')).toHaveValue('');
  expect(screen.getByRole('button', { name: '转入目标轨道' })).toBeDisabled();
  expect(screen.getByText(/已选择 0 份内容/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled(); expect(document.translationTracks[0].contents).toEqual([content]);
});
it('short references keep five complete visible characters and never modify whitespace', async () => {
  const { shortReference } = await import('./TranslationTrackDialog');
  for (const text of ['', '短句', '12345', ' e\u0301👨‍👩‍👧‍👦🇨🇳字']) expect(shortReference(text)).toBe(text);
  expect(shortReference(' e\u0301👨‍👩‍👧‍👦🇨🇳字尾')).toBe(' e\u0301👨‍👩‍👧‍👦🇨🇳字…');
  expect(shortReference('123456')).toBe('12345…');
});
