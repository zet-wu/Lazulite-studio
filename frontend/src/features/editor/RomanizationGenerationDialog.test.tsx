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
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); localStorage.setItem('lazulite-romanization-mode:project:first', 'plain'); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('generates only at entry and mode change, blocks a changed source without replacing manual text', () => {
  const doc = createLyricDocument('きゃ'), apply = vi.fn(() => true), close = vi.fn();
  const props = { document: doc, lineIds: [doc.lines[0].id], preferenceScope: 'project:first', apply, close };
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
  const close = vi.fn(); render(<RomanizationGenerationDialog document={doc} lineIds={[doc.lines[0].id]} preferenceScope="project:first" apply={apply} close={close} />);
  fireEvent.change(screen.getByLabelText('L1音译'), { target: { value: '  manual  ' } });
  fireEvent.click(screen.getByRole('button', { name: '生成音译' })); expect(apply).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(proposeRomanization).toHaveBeenCalledTimes(1);
});

it('remembers output per project after cancellation and generates once in the restored mode', () => {
  const doc = createLyricDocument('かな'), apply = vi.fn(() => true), close = vi.fn();
  const props = { document: doc, lineIds: [doc.lines[0].id], preferenceScope: 'project:first', apply, close };
  let view = render(<RomanizationGenerationDialog {...props} />);
  fireEvent.change(screen.getByLabelText('输出'), { target: { value: 'timed' } });
  fireEvent.change(screen.getByLabelText('L1单元 1音译'), { target: { value: 'discarded' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(apply).not.toHaveBeenCalled(); view.unmount(); vi.clearAllMocks();
  view = render(<RomanizationGenerationDialog {...props} />);
  expect(screen.getByLabelText('输出')).toHaveValue('timed');
  expect(screen.getByLabelText('L1单元 1音译')).toHaveValue('kana');
  expect(proposeRomanization).toHaveBeenCalledExactlyOnceWith(doc, props.lineIds, 'timed');
  view.unmount(); vi.clearAllMocks();
  view = render(<RomanizationGenerationDialog {...props} preferenceScope="project:second" />);
  expect(screen.getByLabelText('输出')).toHaveValue('timed');
  expect(proposeRomanization).toHaveBeenCalledExactlyOnceWith(doc, props.lineIds, 'timed'); view.unmount();
  view = render(<RomanizationGenerationDialog {...props} />);
  fireEvent.change(screen.getByLabelText('输出'), { target: { value: 'plain' } }); view.unmount();
  render(<RomanizationGenerationDialog {...props} />);
  expect(screen.getByLabelText('输出')).toHaveValue('plain');
});

it('defaults to the first ja-Latn track, appends missing content and skips existing content', () => {
  const doc = createLyricDocument('かな'), lineId = doc.lines[0].id;
  doc.romanizationTracks = [
    { id: 'english', language: 'en-Latn', contents: [] },
    { id: 'first', language: 'ja-Latn', contents: [] },
    { id: 'second', language: 'ja-Latn', contents: [] },
  ];
  let result = doc;
  const apply = vi.fn(command => { result = executeLyricCommand(createLyricEditorState(doc), command).present; return true; });
  const props = { document: doc, lineIds: [lineId], preferenceScope: 'project:first', apply, close: vi.fn() };
  let view = render(<RomanizationGenerationDialog {...props} />);
  expect(screen.getByLabelText('目标轨道')).toHaveValue('first');
  expect(screen.getByLabelText('L1生成内容')).toHaveValue('append');
  fireEvent.change(screen.getByLabelText('L1音译'), { target: { value: 'manual' } });
  fireEvent.click(screen.getByRole('button', { name: '生成音译' }));
  expect(result.romanizationTracks).toHaveLength(3);
  expect(result.romanizationTracks[1].contents[0]).toMatchObject({ lineId, kind: 'plain', text: 'manual' });
  expect(result.romanizationTracks[0]).toEqual(doc.romanizationTracks[0]);
  expect(result.romanizationTracks[2]).toEqual(doc.romanizationTracks[2]);
  expect(result.lines).toEqual(doc.lines); view.unmount();
  view = render(<RomanizationGenerationDialog {...props} document={result} />);
  expect(screen.getByLabelText('目标轨道')).toHaveValue('first');
  expect(screen.getByLabelText('L1生成内容')).toHaveValue('skip');
  expect(screen.getByRole('button', { name: '生成音译' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('目标轨道'), { target: { value: '' } });
  expect(screen.getByLabelText('L1生成内容')).toHaveValue('append');
  expect(screen.getByRole('button', { name: '生成音译' })).toBeEnabled();
});

it('uses timed output for missing or invalid preferences without inventing source times', () => {
  const doc = createLyricDocument('かな');
  for (const stored of [null, 'unknown']) {
    const key = 'lazulite-romanization-mode:project:new';
    if (stored === null) localStorage.removeItem(key); else localStorage.setItem(key, stored);
    const apply = vi.fn(command => {
      const result = executeLyricCommand(createLyricEditorState(doc), command).present;
      expect(result.romanizationTracks[0].contents[0]).toMatchObject({kind:'timed', units:[{text:'kana',beginMs:null,endMs:null}]});
      return true;
    });
    const view = render(<RomanizationGenerationDialog document={doc} lineIds={[doc.lines[0].id]} preferenceScope="project:new" apply={apply} close={vi.fn()} />);
    expect(screen.getByLabelText('输出')).toHaveValue('timed');
    fireEvent.click(screen.getByRole('button', {name:'生成音译'})); expect(apply).toHaveBeenCalledOnce();
    view.unmount();
  }
});
