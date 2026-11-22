import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { isMessage, type Message } from '../domain/messages';
import { formatMessage } from '../i18n';
import { IconButton } from '../shared/Controls';
import type { Notice } from '../shared/MessageBar';
import styles from './floating-tray.module.css';

export type TrayItem = {
  id: string;
  order?: number;
  kind: 'task' | 'notice';
  tone?: 'info' | 'warning' | 'alert';
  version?: string | number | boolean | null;
  notice: Notice;
  actions?: ReactNode;
};

type TrayContextValue = {
  upsert: (item: TrayItem) => void;
  remove: (id: string) => void;
};

const TrayContext = createContext<TrayContextValue | null>(null);

export function useOptionalFloatingTray() {
  return useContext(TrayContext);
}

/**
 * Declaratively register an item into the bottom-right FloatingTray when mounted.
 * Automatically updates on dependency changes and removes on unmount.
 */
export function useTrayEntry(id: string, item: Omit<TrayItem, 'id'> | null) {
  const tray = useContext(TrayContext);
  useEffect(() => {
    if (!tray) return;
    if (!item) {
      tray.remove(id);
      return;
    }
    tray.upsert({ id, ...item });
  });
  useEffect(() => () => tray?.remove(id), [tray, id]);
}

function clampPosition(left: number, top: number, width: number, height: number) {
  const margin = 12;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

function TrayRow({
  item,
  paused,
  onDismissed,
}: {
  item: TrayItem;
  paused: boolean;
  onDismissed: (notice: Notice) => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const { notice } = item;

  const hide = useCallback(() => {
    const root = rowRef.current;
    if (root?.contains(document.activeElement)) {
      const tray = root.closest<HTMLElement>('[data-floating-tray]');
      const origin = notice.origin;
      if (
        origin?.isConnected &&
        !origin.closest('[data-floating-tray]') &&
        origin.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]')
      ) {
        origin.focus();
      } else {
        const sibling = tray
          ? Array.from(tray.querySelectorAll<HTMLElement>('button:not(:disabled)')).find((btn) => !root.contains(btn))
          : null;
        if (sibling) sibling.focus();
        else {
          document
            .querySelector<HTMLElement>('[data-workspace] main, [data-workspace] nav button[aria-current="page"]')
            ?.focus();
        }
      }
    }
    onDismissed(notice);
    notice.onDismiss?.();
  }, [notice, onDismissed]);

  useEffect(() => {
    if (!notice.timeout || notice.dismissible === false || paused) return;
    const timer = window.setTimeout(hide, notice.timeout);
    return () => window.clearTimeout(timer);
  }, [notice, paused, hide]);

  const toneClass =
    item.kind === 'task'
      ? styles.itemTask
      : item.tone === 'warning'
        ? styles.itemWarning
        : notice.role === 'alert' || item.tone === 'alert'
          ? styles.itemAlert
          : '';

  const text = isMessage(notice.text) ? formatMessage(notice.text) : notice.text;

  return (
    <div ref={rowRef} data-message-bar className={`${styles.item} ${toneClass}`}>
      <div className={styles.itemTop}>
        <span className={styles.itemText} role={notice.role}>
          {text}
        </span>
        {notice.dismissible !== false && (
          <IconButton icon="close" label={t('notice.dismiss')} onClick={hide} />
        )}
      </div>
      {item.kind === 'task' && (
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
      )}
      {item.actions && <div className={styles.itemActions}>{item.actions}</div>}
    </div>
  );
}

export function FloatingTrayProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Map<string, TrayItem>>(() => new Map());
  const [dismissedNotices, setDismissedNotices] = useState<WeakSet<Notice>>(() => new WeakSet());
  const [collapsed, setCollapsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    width: number;
    height: number;
  } | null>(null);

  const upsert = useCallback((item: TrayItem) => {
    setEntries((prev) => {
      const existing = prev.get(item.id);
      if (
        existing &&
        existing.kind === item.kind &&
        existing.tone === item.tone &&
        existing.order === item.order &&
        existing.notice === item.notice &&
        (item.version !== undefined ? existing.version === item.version : existing.actions === item.actions)
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(item.id, item);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleDismissed = useCallback((notice: Notice) => {
    setDismissedNotices((prev) => {
      if (prev.has(notice)) return prev;
      const next = new WeakSet<Notice>();
      for (const item of entries.values()) {
        if (prev.has(item.notice)) next.add(item.notice);
      }
      next.add(notice);
      return next;
    });
  }, [entries]);

  const visibleItems = useMemo(() => {
    return Array.from(entries.values())
      .filter((item) => !dismissedNotices.has(item.notice))
      .sort((a, b) => {
        const orderA = a.order ?? (a.kind === 'task' ? 10 : a.notice.role === 'alert' ? 20 : 30);
        const orderB = b.order ?? (b.kind === 'task' ? 10 : b.notice.role === 'alert' ? 20 : 30);
        return orderA - orderB;
      });
  }, [entries, dismissedNotices]);

  const taskCount = visibleItems.filter((item) => item.kind === 'task').length;
  const noticeCount = visibleItems.length - taskCount;
  const hasDismissible = visibleItems.some((item) => item.notice.dismissible !== false);

  useLayoutEffect(() => {
    if (!position || !trayRef.current) return;
    const rect = trayRef.current.getBoundingClientRect();
    const clamped = clampPosition(position.left, position.top, rect.width, rect.height);
    if (clamped.left !== position.left || clamped.top !== position.top) {
      setPosition(clamped);
    }
  }, [position, collapsed, visibleItems.length]);

  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      if (!trayRef.current) return;
      const rect = trayRef.current.getBoundingClientRect();
      setPosition((prev) => (prev ? clampPosition(prev.left, prev.top, rect.width, rect.height) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    const box = trayRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: box.left,
      originTop: box.top,
      width: box.width,
      height: box.height,
    };
    setDragging(true);
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragState.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const next = clampPosition(
      active.originLeft + (event.clientX - active.startX),
      active.originTop + (event.clientY - active.startY),
      active.width,
      active.height,
    );
    setPosition(next);
  };

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      setDragging(false);
    }
  };

  const clearAll = () => {
    const dismissible = visibleItems.filter((item) => item.notice.dismissible !== false);
    if (!dismissible.length) return;
    setDismissedNotices((prev) => {
      const next = new WeakSet<Notice>();
      for (const item of entries.values()) {
        if (prev.has(item.notice)) next.add(item.notice);
      }
      for (const item of dismissible) {
        next.add(item.notice);
      }
      return next;
    });
    for (const item of dismissible) {
      item.notice.onDismiss?.();
    }
  };

  const contextValue = useMemo<TrayContextValue>(() => ({ upsert, remove }), [upsert, remove]);

  return (
    <TrayContext.Provider value={contextValue}>
      {children}
      {visibleItems.length > 0 && (
        <aside
          ref={trayRef}
          data-floating-tray
          aria-label={t('tray.title')}
          className={`${styles.tray} ${collapsed ? styles.collapsed : ''} ${dragging ? styles.dragging : ''}`}
          style={
            position
              ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
              : undefined
          }
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
          }}
        >
          <div
            data-tray-handle
            title={t('tray.resetPosition')}
            className={styles.header}
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onPointerCancel={onHeaderPointerUp}
            onDoubleClick={(event) => {
              if (!(event.target as Element).closest('button')) setPosition(null);
            }}
          >
            <span className={styles.grip} aria-hidden="true">
              ⋮⋮
            </span>
            <div className={styles.titleGroup}>
              <span className={styles.title}>{t('tray.title')}</span>
              <span className={styles.summary}>
                {collapsed
                  ? t('tray.summary', { running: taskCount, notices: noticeCount })
                  : `(${visibleItems.length})`}
              </span>
            </div>
            <div className={styles.headerActions}>
              {!collapsed && hasDismissible && (
                <IconButton icon="trash" label={t('tray.clearAll')} onClick={clearAll} />
              )}
              <IconButton
                icon={collapsed ? 'up' : 'down'}
                label={collapsed ? t('tray.expand') : t('tray.collapse')}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((v) => !v)}
              />
            </div>
          </div>
          {!collapsed && (
            <div className={styles.list}>
              {visibleItems.map((item) => (
                <TrayRow key={item.id} item={item} paused={paused} onDismissed={handleDismissed} />
              ))}
            </div>
          )}
        </aside>
      )}
    </TrayContext.Provider>
  );
}
