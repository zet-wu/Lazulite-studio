import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createLyricDocument } from '../../domain/lyric-document';
import { RubyGenerationDialog } from './RubyGenerationDialog';

it('previews the time extension and submits one command only after confirmation', () => {
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
  expect(screen.getAllByText(/1s–2s → 0.999s–2s/)).toHaveLength(2);
  const submit = screen.getByRole('button', { name: '应用（一次撤销）' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByLabelText('确认同时扩展上述词/行时间'));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(apply).toHaveBeenCalledOnce();
  expect(apply.mock.calls[0][0]).toMatchObject({ type: 'batch' });
  expect(close).toHaveBeenCalledOnce();
  expect(lyric.romanizationTracks[0].contents[0]).toMatchObject({ id: 'content' });

  const changed = { ...lyric };
  rerender(<RubyGenerationDialog document={changed} lineIds={[line.id]} apply={apply} close={close} />);
  expect(screen.getByText(/文档已变化/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '应用（一次撤销）' })).toBeNull();
});
