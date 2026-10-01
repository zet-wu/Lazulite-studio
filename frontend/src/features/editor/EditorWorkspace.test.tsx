import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine, createLyricDocument } from '../../domain/lyric-document';
import { EditorWorkspace } from './EditorWorkspace';

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

afterEach(() => { cleanup(); localStorage.clear(); });

it('selects 注音 independently and opens its card menu while leaving input context native', () => {
  const lyric = createLyricDocument('歌');
  const line = lyric.lines[0], word = line.words[0];
  word.rubyUnits = [
    { id: 'r1', reading: 'う', beginMs: null, endMs: null },
    { id: 'r2', reading: 'た', beginMs: null, endMs: null },
  ];
  const apply = vi.fn();
  const { container } = render(<MemoryRouter><EditorWorkspace title="测试" document={lyric} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} /></MemoryRouter>);
  const tile = container.querySelector<HTMLElement>('[data-ruby-id="r1"]')!;
  fireEvent.click(tile);
  expect(screen.getByText('注音已选 1')).toBeVisible();
  fireEvent.contextMenu(tile, { clientX: 20, clientY: 30 });
  fireEvent.click(screen.getByRole('menuitem', { name: '向后移动' }));
  expect(apply).toHaveBeenCalledWith({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId: 'r1', afterRubyId: 'r2' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(screen.getAllByRole('textbox', { name: '读音 歌' })[0]);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('routes desktop history shortcuts only outside inputs, dialogs and IME composition', () => {
  const lyric = createLyricDocument('歌');
  const undo = vi.fn(), redo = vi.fn(), onSave = vi.fn();
  const { container } = render(<MemoryRouter><EditorWorkspace title="测试" document={lyric} apply={() => {}}
    undo={undo} redo={redo} canUndo canRedo dirty onSave={onSave}
    /></MemoryRouter>);
  const line = container.querySelector<HTMLElement>('[data-line-id]')!;
  const word = screen.getByRole('textbox', { name: '词 歌' });
  fireEvent.keyDown(line, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(line, { key: 'Z', metaKey: true, shiftKey: true });
  expect(undo).toHaveBeenCalledOnce();
  expect(redo).toHaveBeenCalledOnce();
  fireEvent.keyDown(word, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(word, { key: 'Z', metaKey: true, shiftKey: true });
  fireEvent.keyDown(line, { key: 'z', ctrlKey: true, isComposing: true });
  expect(undo).toHaveBeenCalledOnce();
  expect(redo).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('歌词设置'));
  fireEvent.click(screen.getByRole('button', { name: '元数据编辑' }));
  fireEvent.keyDown(screen.getByRole('dialog', { name: '元数据编辑' }), { key: 'z', ctrlKey: true });
  expect(undo).toHaveBeenCalledOnce();
  fireEvent.keyDown(line, { key: 's', metaKey: true });
  expect(onSave).toHaveBeenCalledOnce();
});

it('rejects an occupied preceding main row without searching farther back or changing selection', () => {
  const lyric = createLyricDocument();
  lyric.lines = ['未占用', '前主行', '背景', '源行'].map(text => createLine(text));
  lyric.lines[2].backgroundOf = lyric.lines[1].id;
  const apply = vi.fn();
  render(<MemoryRouter><EditorWorkspace title="背景" document={lyric} selectedLineId={lyric.lines[3].id} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} /></MemoryRouter>);
  expect(screen.getByLabelText('所属主行')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('背景歌词'));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('前一主行已有背景');
  expect(screen.getByLabelText('背景歌词')).not.toBeChecked();
  expect(screen.getByText('已选行：L3')).toBeVisible();
});

it('dispatches exactly one attachment to the nearest main row, skipping background rows', () => {
  const lyric = createLyricDocument();
  lyric.lines = ['前行', '背景', '最近主行', '源行'].map(text => createLine(text));
  lyric.lines[1].backgroundOf = lyric.lines[0].id;
  const apply = vi.fn();
  render(<MemoryRouter><EditorWorkspace title="背景" document={lyric} selectedLineId={lyric.lines[3].id} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByLabelText('背景歌词'));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ type: 'set-background-of', lineId: lyric.lines[3].id, parentLineId: lyric.lines[2].id });
});

it('splits from the word menu with default graphemes and preserved spaces, opening advanced tools for a long word', () => {
  const lyric = createLyricDocument('中文 I  still e\u0301'), word = lyric.lines[0].words[0];
  word.beginMs = 0; word.endMs = 1000;
  const apply = vi.fn();
  const { container, rerender } = render(<MemoryRouter><EditorWorkspace title="分词" document={lyric} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} /></MemoryRouter>);
  fireEvent.contextMenu(container.querySelector('[data-word-id]')!);
  fireEvent.click(screen.getByRole('menuitem', { name: '拆分词' }));
  expect(apply.mock.calls[0][0]).toMatchObject({ type: 'segment-words', changes: [{ words: [
    { text: '中', beginMs: 0 }, { text: '文' }, { text: ' ' }, { text: 'I' }, { text: '  ' }, { text: 'still' }, { text: ' ' }, { text: 'e\u0301', endMs: 1000 },
  ] }] });
  word.text = 'internationalization';
  rerender(<MemoryRouter><EditorWorkspace title="分词" document={{ ...lyric }} apply={apply}
    undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} dirty={false}
    onSave={() => {}} /></MemoryRouter>);
  fireEvent.contextMenu(container.querySelector('[data-word-id]')!);
  fireEvent.click(screen.getByRole('menuitem', { name: '拆分词' }));
  expect(screen.getByRole('dialog', { name: '分词' })).toBeVisible();
  expect(apply).toHaveBeenCalledOnce();
});
