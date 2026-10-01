import { createRecoveryAdapter } from './recovery';
export const PROJECT_DELETED = 'studio-project-deleted';
const channelName = 'studio-project-lifecycle';
export function announceProjectDeleted(projectId: string) {
  window.dispatchEvent(new CustomEvent(PROJECT_DELETED, { detail: projectId }));
  const channel = new BroadcastChannel(channelName);
  channel.postMessage(projectId); channel.close();
}
export function listenProjectDeletion(projectId: string, deleted: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent<string>).detail === projectId) deleted(); };
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = event => { if (event.data === projectId) deleted(); };
  window.addEventListener(PROJECT_DELETED, local);
  return () => { channel.close(); window.removeEventListener(PROJECT_DELETED, local); };
}
export async function clearProjectLocalData(projectId: string) {
  localStorage.removeItem(`lazulite-romanization-mode:project:${projectId}`);
  await createRecoveryAdapter().clear(projectId);
}
