import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingTrayProvider, useTrayEntry } from './FloatingTray';
import { useNotice } from '../shared/MessageBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function TrayHarness({ showTask = true }: { showTask?: boolean }) {
  const [notice, publish] = useNotice();
  const [alertNotice, publishAlert] = useNotice();
  useTrayEntry(
    'task-1',
    showTask
      ? {
          kind: 'task',
          order: 10,
          version: 'j1:running',
          notice: { text: '自动对齐 · 正在全局对齐', role: 'status', origin: null, dismissible: false },
          actions: <button data-role="secondary">取消任务</button>,
        }
      : null,
  );
  useTrayEntry('notice-1', notice ? { kind: 'notice', notice } : null);
  useTrayEntry('alert-1', alertNotice ? { kind: 'notice', notice: alertNotice } : null);

  return (
    <main data-workspace>
      <input aria-label="歌词输入" />
      <button onClick={() => publish('已更新', 'status', 3000)}>发布普通提示</button>
      <button onClick={() => publishAlert('保存失败', 'alert')}>发布错误</button>
    </main>
  );
}

describe('FloatingTray', () => {
  it('renders tasks and notices passively without stealing focus, and supports collapse and clear', () => {
    render(
      <FloatingTrayProvider>
        <TrayHarness />
      </FloatingTrayProvider>,
    );

    const input = screen.getByLabelText('歌词输入');
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByText('发布普通提示'));
    fireEvent.click(screen.getByText('发布错误'));

    const tray = screen.getByLabelText('消息与处理队列');
    expect(tray).toBeInTheDocument();
    expect(screen.getByText('自动对齐 · 正在全局对齐')).toBeInTheDocument();
    expect(screen.getByText('已更新')).toBeInTheDocument();
    expect(screen.getByText('保存失败')).toBeInTheDocument();
    expect(document.activeElement).not.toBeNull();
    expect(tray.contains(document.activeElement)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '清空提示' }));
    expect(screen.queryByText('已更新')).not.toBeInTheDocument();
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument();
    expect(screen.getByText('自动对齐 · 正在全局对齐')).toBeInTheDocument();

    const collapseBtn = screen.getByRole('button', { name: '折叠浮层' });
    fireEvent.click(collapseBtn);
    expect(screen.queryByText('自动对齐 · 正在全局对齐')).not.toBeInTheDocument();
    expect(screen.getByText('1 运行中 · 0 提示')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开浮层' }));
    expect(screen.getByText('自动对齐 · 正在全局对齐')).toBeInTheDocument();
  });

  it('pauses auto-dismiss while hovered or focused and restores focus on manual dismiss', () => {
    vi.useFakeTimers();
    render(
      <FloatingTrayProvider>
        <TrayHarness showTask={false} />
      </FloatingTrayProvider>,
    );

    const trigger = screen.getByText('发布普通提示');
    trigger.focus();
    fireEvent.click(trigger);

    const tray = screen.getByLabelText('消息与处理队列');
    fireEvent.mouseEnter(tray);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('已更新')).toBeInTheDocument();

    fireEvent.mouseLeave(tray);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText('已更新')).not.toBeInTheDocument();

    // Manual dismiss returns focus to origin when dismissed by keyboard.
    trigger.focus();
    fireEvent.click(trigger);
    const dismissBtn = screen.getByRole('button', { name: '关闭提示' });
    dismissBtn.focus();
    fireEvent.click(dismissBtn);
    expect(document.activeElement).toBe(trigger);
  });

  it('clamps dragged position inside viewport and resets on header double-click', () => {
    render(
      <FloatingTrayProvider>
        <TrayHarness />
      </FloatingTrayProvider>,
    );

    const tray = screen.getByLabelText('消息与处理队列');
    const handle = tray.querySelector('[data-tray-handle]') as HTMLElement;
    tray.getBoundingClientRect = () =>
      ({ left: 600, top: 400, width: 356, height: 140, right: 956, bottom: 540, x: 600, y: 400, toJSON: () => {} }) as DOMRect;
    handle.setPointerCapture = vi.fn();

    const pointer = (type: string, props: Record<string, unknown>) =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), props);

    act(() => {
      handle.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 1, clientX: 650, clientY: 420 }));
      handle.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: -500, clientY: -500 }));
      handle.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
    });

    expect(tray.style.left).toBe('12px');
    expect(tray.style.top).toBe('12px');

    fireEvent.doubleClick(handle);
    expect(tray.style.left).toBe('');
    expect(tray.style.top).toBe('');
  });
});
