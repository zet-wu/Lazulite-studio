import { apiFetch } from './client';
import { isBrowserRuntime } from '../runtime';
import { retainBrowserMedia } from '../browser/media';

/** A page retains its project's decoded media across pause and focus changes. */
export function retainProjectMedia(projectId: string, onError: (error: unknown) => void) {
  if (isBrowserRuntime) return retainBrowserMedia(projectId);
  let pageId = crypto.randomUUID();
  let active = true;
  const send = (method: 'PUT' | 'DELETE') =>
    apiFetch(`/projects/${encodeURIComponent(projectId)}/media-users/${pageId}`, { method, keepalive: true });
  const renew = () => { if (active) void send('PUT').catch(onError); };
  const leave = () => { if (active) { active = false; void send('DELETE').catch(onError); } };
  const resume = () => { if (!active) { pageId = crypto.randomUUID(); active = true; renew(); } };
  const visible = () => { if (document.visibilityState === 'visible') renew(); };
  renew();
  const timer = window.setInterval(renew, 30_000);
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', resume);
    document.removeEventListener('visibilitychange', visible);
    leave();
  };
}
