import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createLine } from '../../domain/lyric-document';
import { SingerSelection } from './SingerSelection';
afterEach(cleanup);

it('shows mixed singer memberships and changes only the chosen membership while preserving other references and order', () => {
  const agents = ['v1', 'v2', 'v3'].map(id => ({ id, name: id, type: 'person' as const }));
  const lines = [createLine('a', 'a'), createLine('b', 'b')];
  lines[0].agentRefs = ['v2', 'v1']; lines[1].agentRefs = ['v3'];
  const apply = vi.fn(() => true);
  render(<SingerSelection agents={agents} lines={lines} apply={apply} />);
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText('混合值')).toBeVisible();
  expect(screen.getByLabelText('歌手 v1')).toHaveAttribute('aria-checked', 'mixed');
  fireEvent.click(screen.getByLabelText('歌手 v1'));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ type: 'batch', commands: [{ type: 'set-line-agents', lineId: 'b', agentRefs: ['v3', 'v1'] }] });
});
