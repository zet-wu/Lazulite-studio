import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { EditorWorkspace } from './EditorWorkspace';

it('selects Ruby independently and opens its card menu while leaving input context native', () => {
  const lyric = createLyricDocument('歌');
  const line = lyric.lines[0], word = line.words[0];
  word.rubyUnits = [
    { id: 'r1', reading: 'う', beginUs: null, endUs: null },
    { id: 'r2', reading: 'た', beginUs: null, endUs: null },
  ];
  const apply = vi.fn();
  const { container } = render(<MemoryRouter><EditorWorkspace title="测试" document={lyric} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} onDraft={() => {}} onFinal={() => {}} /></MemoryRouter>);
  const tile = container.querySelector<HTMLElement>('[data-ruby-id="r1"]')!;
  fireEvent.click(tile);
  expect(screen.getByText('Ruby已选 1')).toBeVisible();
  fireEvent.contextMenu(tile, { clientX: 20, clientY: 30 });
  fireEvent.click(screen.getByRole('menuitem', { name: '向后移动' }));
  expect(apply).toHaveBeenCalledWith({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId: 'r1', afterRubyId: 'r2' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(screen.getAllByRole('textbox', { name: '读音 歌' })[0]);
  expect(screen.queryByRole('menu')).toBeNull();
});
