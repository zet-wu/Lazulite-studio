import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
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

const DEFAULT_STATUS_TIMEOUT_MS = 4000;
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

function isSimpleStatusNotice(item: TrayItem): boolean {
  return (
    item.kind === 'notice' &&
    item.notice.role === 'status' &&
    item.tone !== 'warning' &&
    item.tone !== 'alert' &&
    !item.actions &&
    item.notice.dismissible !== false
  );
}

function resolveAutoDismissMs(item: TrayItem): number | null {
  if (!isSimpleStatusNotice(item)) return null;
  if (item.notice.timeout === undefined) return DEFAULT_STATUS_TIMEOUT_MS;
  return item.notice.timeout > 0 ? item.notice.timeout : null;
}

function TrayRow({
  item,
  snackbar,
  showCollapse,
  onCollapse,
  onDismiss,
}: {
  item: TrayItem;
  snackbar: boolean;
  showCollapse: boolean;
  onCollapse: () => void;
  onDismiss: (notice: Notice, rowEl?: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const { notice } = item;

  const toneClass = snackbar
    ? styles.itemSnackbar
    : item.kind === 'task'
      ? styles.itemTask
      : item.tone === 'warning'
        ? styles.itemWarning
        : notice.role === 'alert' || item.tone === 'alert'
          ? styles.itemAlert
          : item.actions
            ? styles.itemAccent
            : '';

  const text = isMessage(notice.text) ? formatMessage(notice.text) : notice.text;

  return (
    <div ref={rowRef} data-message-bar className={`${styles.item} ${toneClass}`}>
      <div className={styles.itemTop}>
        <span className={styles.itemText} role={notice.role}>
          {text}
        </span>
        {(showCollapse || notice.dismissible !== false) && (
          <div className={styles.rowActions}>
            {showCollapse && (
              <IconButton
                className={styles.collapseBtn}
                icon="down"
                label={t('tray.collapse')}
                aria-expanded={true}
                onClick={onCollapse}
              />
            )}
            {notice.dismissible !== false && (
              <IconButton
                icon="close"
                label={t('notice.dismiss')}
                onClick={() => onDismiss(notice, rowRef.current)}
              />
            )}
          </div>
        )}
      </div>
      {item.actions && <div className={styles.itemActions}>{item.actions}</div>}
      {item.kind === 'task' && (
        <div className={`${styles.progressTrack} ${styles.progressTrackEdge}`} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
      )}
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
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const timersRef = useRef<
    Map<Notice, { remainingMs: number; startedAt: number | null; timeoutId: number | null }>
  >(new Map());
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

  const restoreFocusForNotice = (notice: Notice, rowEl?: HTMLElement | null) => {
    const tray = trayRef.current;
    if (!tray?.contains(document.activeElement)) return;
    if (rowEl && !rowEl.contains(document.activeElement)) return;
    const origin = notice.origin;
    if (
      origin?.isConnected &&
      !origin.closest('[data-floating-tray]') &&
      origin.matches(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]',
      )
    ) {
      origin.focus();
      return;
    }
    const sibling = Array.from(tray.querySelectorAll<HTMLElement>('button:not(:disabled)')).find(
      (btn) => !rowEl?.contains(btn),
    );
    if (sibling) {
      sibling.focus();
      return;
    }
    document
      .querySelector<HTMLElement>('[data-workspace] main, [data-workspace] nav button[aria-current="page"]')
      ?.focus();
  };

  const dismissNotice = useCallback((notice: Notice, rowEl?: HTMLElement | null) => {
    restoreFocusForNotice(notice, rowEl);
    const record = timersRef.current.get(notice);
    if (record) {
      if (record.timeoutId !== null) window.clearTimeout(record.timeoutId);
      timersRef.current.delete(notice);
    }
    setDismissedNotices((prev) => {
      if (prev.has(notice)) return prev;
      const next = new WeakSet<Notice>();
      for (const item of entriesRef.current.values()) {
        if (prev.has(item.notice)) next.add(item.notice);
      }
      next.add(notice);
      return next;
    });
    notice.onDismiss?.();
  }, []);

  const visibleItems = useMemo(() => {
    return Array.from(entries.values())
      .filter((item) => !dismissedNotices.has(item.notice))
      .sort((a, b) => {
        const orderA = a.order ?? (a.kind === 'task' ? 10 : a.notice.role === 'alert' ? 20 : 30);
        const orderB = b.order ?? (b.kind === 'task' ? 10 : b.notice.role === 'alert' ? 20 : 30);
        return orderA - orderB;
      });
  }, [entries, dismissedNotices]);

  const isSingleSimpleNotice = visibleItems.length === 1 && isSimpleStatusNotice(visibleItems[0]);
  const isCollapsed = collapsed && !isSingleSimpleNotice;

  useEffect(() => {
    if (visibleItems.length === 0) {
      setPaused(false);
      setCollapsed(false);
      setDragging(false);
      dragState.current = null;
    } else if (isSingleSimpleNotice && collapsed) {
      setCollapsed(false);
    }
  }, [visibleItems.length, isSingleSimpleNotice, collapsed]);

  useEffect(() => {
    const timers = timersRef.current;
    const activeAuto = new Map<Notice, number>();
    for (const item of visibleItems) {
      const ms = resolveAutoDismissMs(item);
      if (ms !== null) activeAuto.set(item.notice, ms);
    }
    for (const [notice, record] of timers) {
      if (!activeAuto.has(notice)) {
        if (record.timeoutId !== null) window.clearTimeout(record.timeoutId);
        timers.delete(notice);
      }
    }
    for (const [notice, ms] of activeAuto) {
      let record = timers.get(notice);
      if (!record) {
        record = { remainingMs: ms, startedAt: null, timeoutId: null };
        timers.set(notice, record);
      }
      if (paused) {
        if (record.timeoutId !== null) {
          window.clearTimeout(record.timeoutId);
          record.timeoutId = null;
        }
        if (record.startedAt !== null) {
          record.remainingMs = Math.max(0, record.remainingMs - (Date.now() - record.startedAt));
          record.startedAt = null;
        }
      } else if (record.timeoutId === null) {
        record.startedAt = Date.now();
        record.timeoutId = window.setTimeout(() => {
          record.timeoutId = null;
          record.startedAt = null;
          dismissNotice(notice);
        }, record.remainingMs);
      }
    }
  }, [visibleItems, paused, dismissNotice]);

  useEffect(
    () => () => {
      for (const record of timersRef.current.values()) {
        if (record.timeoutId !== null) window.clearTimeout(record.timeoutId);
      }
      timersRef.current.clear();
    },
    [],
  );

  const taskCount = visibleItems.filter((item) => item.kind === 'task').length;
  const noticeCount = visibleItems.length - taskCount;
  const summaryParts: string[] = [];
  if (taskCount > 0) summaryParts.push(t('tray.runningCount', { count: taskCount }));
  if (noticeCount > 0) summaryParts.push(t('tray.noticeCount', { count: noticeCount }));

  useLayoutEffect(() => {
    if (!position || !trayRef.current) return;
    const rect = trayRef.current.getBoundingClientRect();
    const clamped = clampPosition(position.left, position.top, rect.width, rect.height);
    if (clamped.left !== position.left || clamped.top !== position.top) {
      setPosition(clamped);
    }
  }, [position, isCollapsed, isSingleSimpleNotice, visibleItems.length]);

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

  const nonDraggableTarget = (target: EventTarget | null) =>
    (target as Element | null)?.closest(
      `button, a, input, select, textarea, [role="button"], .${styles.itemText}`,
    );

  const onTrayPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || nonDraggableTarget(event.target)) return;
    const box = trayRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
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

  const onTrayPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
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

  const onTrayPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      setDragging(false);
    }
  };

  const onBlankDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!nonDraggableTarget(event.target)) setPosition(null);
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
          className={`${styles.tray} ${
            isCollapsed ? styles.collapsed : isSingleSimpleNotice ? styles.snackbar : ''
          } ${dragging ? styles.dragging : ''}`}
          style={
            position
              ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
              : undefined
          }
          onPointerDown={onTrayPointerDown}
          onPointerMove={onTrayPointerMove}
          onPointerUp={onTrayPointerUp}
          onPointerCancel={onTrayPointerUp}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
          }}
        >
          {isCollapsed ? (
            <div
              data-tray-handle
              title={t('tray.resetPosition')}
              className={styles.collapsedBar}
              onDoubleClick={onBlankDoubleClick}
            >
              <div className={styles.titleGroup}>
                <span className={styles.title}>{t('tray.title')}</span>
                {summaryParts.length > 0 && (
                  <span className={styles.summary}>{summaryParts.join(' · ')}</span>
                )}
              </div>
              <div className={styles.headerActions}>
                <IconButton
                  className={styles.collapseBtn}
                  icon="up"
                  label={t('tray.expand')}
                  aria-expanded={false}
                  onClick={() => setCollapsed(false)}
                />
              </div>
              {taskCount > 0 && (
                <div className={`${styles.progressTrack} ${styles.progressTrackEdge}`} aria-hidden="true">
                  <div className={styles.progressBar} />
                </div>
              )}
            </div>
          ) : (
            <div
              data-tray-handle
              title={t('tray.resetPosition')}
              className={styles.list}
              onDoubleClick={onBlankDoubleClick}
            >
              {visibleItems.map((item, index) => (
                <TrayRow
                  key={item.id}
                  item={item}
                  snackbar={isSingleSimpleNotice}
                  showCollapse={!isSingleSimpleNotice && index === 0}
                  onCollapse={() => setCollapsed(true)}
                  onDismiss={dismissNotice}
                />
              ))}
            </div>
          )}
        </aside>
      )}
    </TrayContext.Provider>
  );
}
