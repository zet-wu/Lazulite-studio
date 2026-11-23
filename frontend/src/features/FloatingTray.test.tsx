import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingTrayProvider, useTrayEntry } from './FloatingTray';
import { useNotice } from '../shared/MessageBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function TrayHarness({ showTask = true, showActionNotice = false }: { showTask?: boolean; showActionNotice?: boolean }) {
  const [notice, publish] = useNotice();
  const [defaultNotice, publishDefault] = useNotice();
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
  useTrayEntry(
    'action-notice',
    showActionNotice
      ? {
          kind: 'notice',
          tone: 'info',
          order: 15,
          notice: { text: '后台自动对齐已完成', role: 'status', origin: null, dismissible: true },
          actions: <button data-role="primary">应用</button>,
        }
      : null,
  );
  useTrayEntry('notice-1', notice ? { kind: 'notice', notice } : null);
  useTrayEntry('notice-default', defaultNotice ? { kind: 'notice', notice: defaultNotice } : null);
  useTrayEntry('alert-1', alertNotice ? { kind: 'notice', notice: alertNotice } : null);

  return (
    <main data-workspace>
      <input aria-label="歌词输入" />
      <button onClick={() => publish('已更新', 'status', 3000)}>发布普通提示</button>
      <button onClick={() => publishDefault('外部同步完成', 'status')}>发布默认超时提示</button>
      <button onClick={() => publishAlert('保存失败', 'alert')}>发布错误</button>
    </main>
  );
}

describe('FloatingTray', () => {
  it('omits header and clear-all in expanded mode, and shows single snackbar vs multi-row collapse controls', () => {
    const view = render(
      <FloatingTrayProvider>
        <TrayHarness showTask={false} />
      </FloatingTrayProvider>,
    );

    const input = screen.getByLabelText('歌词输入');
    input.focus();
    expect(document.activeElement).toBe(input);

    // Single plain status notice renders as lightweight snackbar without title, clearAll, or collapse button.
    fireEvent.click(screen.getByText('发布默认超时提示'));
    const tray = screen.getByLabelText('消息与处理队列');
    expect(tray).toBeInTheDocument();
    expect(screen.getByText('外部同步完成')).toBeInTheDocument();
    expect(screen.queryByText('消息与处理队列')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清空提示' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '折叠浮层' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭提示' })).toBeInTheDocument();
    expect(tray.contains(document.activeElement)).toBe(false);

    // Adding an alert expands to stack mode with collapse button on first row.
    fireEvent.click(screen.getByText('发布错误'));
    expect(screen.queryByText('消息与处理队列')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清空提示' })).not.toBeInTheDocument();
    const collapseBtn = screen.getByRole('button', { name: '折叠浮层' });
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    // Collapsed mode shows title, non-zero summary only, and expand button.
    fireEvent.click(collapseBtn);
    expect(screen.getByText('消息与处理队列')).toBeInTheDocument();
    expect(screen.getByText('2 提示')).toBeInTheDocument();
    expect(screen.queryByText(/运行中/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开浮层' })).toHaveAttribute('aria-expanded', 'false');

    // Including a running task shows non-zero task + notice counts when collapsed.
    view.rerender(
      <FloatingTrayProvider>
        <TrayHarness showTask={true} />
      </FloatingTrayProvider>,
    );
    expect(screen.getByText('1 运行中 · 2 提示')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开浮层' }));
    expect(screen.getByText('自动对齐 · 正在全局对齐')).toBeInTheDocument();
    expect(screen.queryByText('消息与处理队列')).not.toBeInTheDocument();

    // Actioned notice renders collapse button even when alone.
    view.rerender(
      <FloatingTrayProvider>
        <TrayHarness showTask={false} showActionNotice={true} />
      </FloatingTrayProvider>,
    );
    for (const btn of screen.getAllByRole('button', { name: '关闭提示' }).slice(1)) {
      fireEvent.click(btn);
    }
    expect(screen.getByText('后台自动对齐已完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '折叠浮层' })).toBeInTheDocument();
  });

  it('auto-dismisses status notices (default 4000ms) even while collapsed, pauses on hover/focus, and preserves tasks/alerts/actions', () => {
    vi.useFakeTimers();
    render(
      <FloatingTrayProvider>
        <TrayHarness showTask={true} showActionNotice={true} />
      </FloatingTrayProvider>,
    );

    const trigger = screen.getByText('发布默认超时提示');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('发布错误'));

    const tray = screen.getByLabelText('消息与处理队列');

    // Hover pauses timer.
    fireEvent.mouseEnter(tray);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('外部同步完成')).toBeInTheDocument();

    // Collapse while leaving mouse -> timer resumes and auto-dismisses even in collapsed state.
    fireEvent.mouseLeave(tray);
    fireEvent.click(screen.getByRole('button', { name: '折叠浮层' }));
    // Move focus out of tray so focus-pause is cleared.
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(screen.getByText('1 运行中 · 3 提示')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('1 运行中 · 2 提示')).toBeInTheDocument();

    // Expand and verify task, action notice, and alert stay open after long elapsed time.
    fireEvent.click(screen.getByRole('button', { name: '展开浮层' }));
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('外部同步完成')).not.toBeInTheDocument();
    expect(screen.getByText('自动对齐 · 正在全局对齐')).toBeInTheDocument();
    expect(screen.getByText('后台自动对齐已完成')).toBeInTheDocument();
    expect(screen.getByText('保存失败')).toBeInTheDocument();

    // Explicit 3000ms status notice pauses on focus inside tray and dismisses after blur.
    const timedTrigger = screen.getByText('发布普通提示');
    timedTrigger.focus();
    fireEvent.click(timedTrigger);
    const input = screen.getByLabelText('歌词输入');
    fireEvent.focusIn(tray);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('已更新')).toBeInTheDocument();
    fireEvent.focusIn(input);
    fireEvent.blur(tray, { relatedTarget: input });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText('已更新')).not.toBeInTheDocument();

    // Manual dismiss returns focus to origin when dismissed by keyboard.
    timedTrigger.focus();
    fireEvent.click(timedTrigger);
    const dismissButtons = screen.getAllByRole('button', { name: '关闭提示' });
    const lastDismiss = dismissButtons[dismissButtons.length - 1];
    lastDismiss.focus();
    fireEvent.click(lastDismiss);
    expect(document.activeElement).toBe(timedTrigger);
  });

  it('clamps dragged position inside viewport from blank areas, ignores text/buttons, and resets on blank double-click', () => {
    render(
      <FloatingTrayProvider>
        <TrayHarness />
      </FloatingTrayProvider>,
    );

    const tray = screen.getByLabelText('消息与处理队列');
    const handle = tray.querySelector('[data-tray-handle]') as HTMLElement;
    expect(tray.textContent).not.toContain('⋮⋮');
    tray.getBoundingClientRect = () =>
      ({ left: 600, top: 400, width: 320, height: 140, right: 920, bottom: 540, x: 600, y: 400, toJSON: () => {} }) as DOMRect;
    tray.setPointerCapture = vi.fn();

    const pointer = (type: string, props: Record<string, unknown>) =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), props);

    // Dragging from message text or interactive button does not move the tray.
    const itemText = screen.getByText('自动对齐 · 正在全局对齐');
    const cancelBtn = screen.getByRole('button', { name: '取消任务' });
    act(() => {
      itemText.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 1, clientX: 650, clientY: 460 }));
      tray.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 500, clientY: 300 }));
      tray.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
      cancelBtn.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 2, clientX: 650, clientY: 480 }));
      tray.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 500, clientY: 300 }));
      tray.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
    });
    expect(tray.style.left).toBe('');
    expect(tray.style.top).toBe('');

    // Dragging from blank card area moves and clamps position.
    const messageBar = itemText.closest('[data-message-bar]') as HTMLElement;
    act(() => {
      messageBar.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 3, clientX: 650, clientY: 460 }));
      tray.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: -500, clientY: -500 }));
      tray.dispatchEvent(pointer('pointerup', { pointerId: 3 }));
    });

    expect(tray.style.left).toBe('12px');
    expect(tray.style.top).toBe('12px');

    // Double-click on blank container resets position, while double-click on text does not.
    fireEvent.doubleClick(itemText);
    expect(tray.style.left).toBe('12px');
    fireEvent.doubleClick(handle);
    expect(tray.style.left).toBe('');
    expect(tray.style.top).toBe('');
  });
});
