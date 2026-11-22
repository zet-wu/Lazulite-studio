export type ProjectRevisionEvent = {
  type: 'revision_changed';
  project_id: string;
  revision: string;
  source_asset_id: string | null;
};

export type ProjectJobEvent = {
  type: 'job_updated';
  project_id: string;
  job_id: string;
  kind: string;
  status: string;
  stage: string | null;
};

export type ProjectEventHandlers = {
  onRevisionChanged?: (event: ProjectRevisionEvent) => void;
  onJobUpdated?: (event: ProjectJobEvent) => void;
  onResync?: () => void;
};

/**
 * Subscribe to server-sent project events and window-focus reconciliation.
 * EventSource automatically reconnects with backoff on transient network drops.
 */
export function subscribeProjectEvents(projectId: string, handlers: ProjectEventHandlers): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let attempt = 0;

  const connect = () => {
    if (closed || typeof EventSource === 'undefined') return;
    source?.close();
    source = new EventSource(`/api/v1/projects/${encodeURIComponent(projectId)}/events`, {
      withCredentials: true,
    });
    source.onopen = () => {
      if (attempt > 0) handlers.onResync?.();
      attempt = 0;
    };
    source.addEventListener('revision_changed', (raw) => {
      try {
        const parsed = JSON.parse((raw as MessageEvent<string>).data) as ProjectRevisionEvent;
        handlers.onRevisionChanged?.(parsed);
      } catch {
        // Ignore malformed payloads.
      }
    });
    source.addEventListener('job_updated', (raw) => {
      try {
        const parsed = JSON.parse((raw as MessageEvent<string>).data) as ProjectJobEvent;
        handlers.onJobUpdated?.(parsed);
      } catch {
        // Ignore malformed payloads.
      }
    });
    source.onerror = () => {
      if (closed) return;
      if (source?.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      }
    };
  };

  connect();

  const handleFocus = () => {
    if (!closed) handlers.onResync?.();
  };
  const handleVisibility = () => {
    if (!closed && document.visibilityState === 'visible') handlers.onResync?.();
  };
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    closed = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    source?.close();
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
