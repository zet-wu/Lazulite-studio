import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { executeLyricCommand, createLyricEditorState } from '../../domain/lyric-commands';
import { RomanizationGenerationDialog } from './RomanizationGenerationDialog';
import { proposeRomanization } from '../../domain/romanization-generation';
vi.mock('../../domain/romanization-generation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../domain/romanization-generation')>();
  return { ...actual, proposeRomanization: vi.fn(actual.proposeRomanization) };
});
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('generates only at entry and mode change, blocks a changed source without replacing manual text', () => {
  const doc = createLyricDocument('きゃ'), apply = vi.fn(() => true), close = vi.fn();
  const props = { document: doc, lineIds: [doc.lines[0].id], apply, close };
  const view = render(<RomanizationGenerationDialog {...props} />);
  expect(proposeRomanization).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('L1音译'), { target: { value: 'manual' } });
  fireEvent.change(screen.getByLabelText('L1生成内容'), { target: { value: 'append' } });
  fireEvent.focus(screen.getByLabelText('L1音译'));
  expect(proposeRomanization).toHaveBeenCalledTimes(1);
  view.rerender(<RomanizationGenerationDialog {...props} document={{ ...doc }} />);
  expect(screen.getByLabelText('L1音译')).toHaveValue('manual'); expect(proposeRomanization).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '生成音译' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('文档已变化');
  fireEvent.change(screen.getByLabelText('输出'), { target: { value: 'timed' } });
  expect(proposeRomanization).toHaveBeenCalledTimes(2); expect(screen.getByLabelText('L1单元 1音译')).toHaveValue('kya');
});
it('submits an active manual ordinary field even when the source has no reading', () => {
  const doc = createLyricDocument('漢字');
  const apply = vi.fn(command => { const next = executeLyricCommand(createLyricEditorState(doc), command).present; expect(next.romanizationTracks[0].contents[0]).toMatchObject({ text: '  manual  ' }); expect(next.lines).toEqual(doc.lines); return true; });
  const close = vi.fn(); render(<RomanizationGenerationDialog document={doc} lineIds={[doc.lines[0].id]} apply={apply} close={close} />);
  fireEvent.change(screen.getByLabelText('L1音译'), { target: { value: '  manual  ' } });
  fireEvent.click(screen.getByRole('button', { name: '生成音译' })); expect(apply).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(proposeRomanization).toHaveBeenCalledTimes(1);
});
