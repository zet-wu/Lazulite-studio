import { readApiError, requestHeaders } from './client';

/** A page retains its project's decoded media across pause and focus changes. */
export function retainProjectMedia(projectId: string, onError: (error: unknown) => void) {
  let pageId = crypto.randomUUID();
  let active = true;
  const send = async (method: 'PUT' | 'DELETE') => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/media-users/${pageId}`, {
      method, credentials: 'include', headers: requestHeaders(), keepalive: true,
    });
    if (!response.ok) throw await readApiError(response);
  };
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
