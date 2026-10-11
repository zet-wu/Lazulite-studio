import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageBar, useNotice } from './MessageBar';
afterEach(()=>{cleanup();vi.useRealTimers();});
function Harness(){
 const [first,publish]=useNotice(),[second,other]=useNotice();
 return <main><button onClick={()=>publish('已更新歌词时间','status',4000)}>成功</button><button onClick={()=>publish('部分时间保留原值','status',8000)}>部分</button><button onClick={()=>publish('失败')}>失败</button><button onClick={()=>other('保存失败')}>保存</button><MessageBar notice={first}/><MessageBar notice={second}/></main>;
}
it('dismisses only one event, returns focus, and republishes identical text',()=>{
 const view=render(<Harness/>);const start=screen.getByText('成功');start.focus();fireEvent.click(start);fireEvent.click(screen.getByText('保存'));
 const close=screen.getAllByRole('button',{name:'关闭提示'})[0];expect(close.querySelector('svg')).toBeTruthy();close.focus();fireEvent.click(close);
 expect(start).toHaveFocus();expect(screen.queryByText('已更新歌词时间')).toBeNull();expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
 view.rerender(<Harness/>);expect(screen.queryByText('已更新歌词时间')).toBeNull();fireEvent.click(start);expect(screen.getByRole('status')).toHaveTextContent('已更新歌词时间');
});
it('expires at four/eight seconds, never expires errors, and cleans old timers',()=>{
 vi.useFakeTimers();const view=render(<Harness/>);fireEvent.click(screen.getByText('成功'));act(()=>vi.advanceTimersByTime(3999));expect(screen.getByRole('status')).toBeVisible();act(()=>vi.advanceTimersByTime(1));expect(screen.queryByRole('status')).toBeNull();
 fireEvent.click(screen.getByText('部分'));act(()=>vi.advanceTimersByTime(7999));expect(screen.getByRole('status')).toBeVisible();act(()=>vi.advanceTimersByTime(1));expect(screen.queryByRole('status')).toBeNull();
 fireEvent.click(screen.getByText('成功'));act(()=>vi.advanceTimersByTime(2000));fireEvent.click(screen.getByText('失败'));act(()=>vi.advanceTimersByTime(30000));expect(screen.getByRole('alert')).toHaveTextContent('失败');
 fireEvent.click(screen.getByText('成功'));fireEvent.click(screen.getByRole('button',{name:'关闭提示'}));expect(vi.getTimerCount()).toBe(0);
 fireEvent.click(screen.getByText('成功'));view.unmount();expect(vi.getTimerCount()).toBe(0);
});
it('keeps running status non-dismissible and pauses timed actions while focused',()=>{
 vi.useFakeTimers();
 const view=render(<MessageBar notice={{text:'自动对齐 · 运行中',role:'status',origin:null,dismissible:false,timeout:4000}} actions={<button>取消任务</button>}/>);
 expect(screen.queryByRole('button',{name:'关闭提示'})).toBeNull();act(()=>vi.advanceTimersByTime(5000));expect(screen.getByText('自动对齐 · 运行中')).toBeVisible();
 view.rerender(<MessageBar notice={{text:'完成',role:'status',origin:null,timeout:4000}} actions={<button>查看结果</button>}/>);
 act(()=>screen.getByRole('button',{name:'查看结果'}).focus());act(()=>vi.advanceTimersByTime(10000));expect(screen.getByText('完成')).toBeVisible();
 act(()=>screen.getByRole('button',{name:'查看结果'}).blur());act(()=>vi.advanceTimersByTime(4000));expect(screen.queryByText('完成')).toBeNull();
});
