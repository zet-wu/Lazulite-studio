import type { Page } from '@playwright/test';
/** Every project owns a fresh upload even when its bytes match a fixture. */
export async function uploadFixtureMusic(page: Page) {
  const audio = await page.request.get('/api/v1/projects/phase0-packaging/audio');
  const response = await page.request.post('/api/v1/uploads', { headers: { origin: 'http://127.0.0.1:5175' }, multipart: { file: { name: 'fixture.wav', mimeType: 'audio/wav', buffer: await audio.body() } } });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()).id as string;
}
