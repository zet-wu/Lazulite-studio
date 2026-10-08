import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OutputIssues } from './OutputIssues';
import type { OutputIssue } from '../adapters/output-validation';
it('lazily expands rule and line groups, pages details and locates the selected object', () => {
  const issues: OutputIssue[] = Array.from({length: 120}, (_,i) => ({kind:'word',lineId:'line',wordId:`w${i}`,code:'missing-time',missing:['begin'],message:`第 1 行第 ${i+1} 词：缺少开始时间`,formats:['TTML','发布歌词'],severity:'error'}));
  const locate = vi.fn();
  const {container} = render(<OutputIssues issues={issues} locate={locate}/>);
  expect(container.querySelectorAll('li')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:/^缺少时间/}));
  expect(container.querySelectorAll('li')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:/^第 1 行/}));
  expect(container.querySelectorAll('li')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button',{name:/再显示 50 项/}));
  expect(container.querySelectorAll('li')).toHaveLength(100);
  fireEvent.click(screen.getByRole('button',{name:issues[99].message}));
  expect(locate).toHaveBeenCalledWith(issues[99]);
});
