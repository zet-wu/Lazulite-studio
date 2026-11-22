import { expect, test } from '@playwright/test';

test('production spectrum renders without exposing diagnostics by default', async ({ page }) => {
  await page.goto('/projects/synthetic/edit');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  const spectrum = page.locator('[data-spectrum-ready]');
  await expect.poll(async () => {
    const wanted = await spectrum.getAttribute('data-spectrum-wanted');
    return wanted !== null && wanted === await spectrum.getAttribute('data-spectrum-ready');
  }, { timeout: 15_000 }).toBe(true);
  await expect(spectrum).not.toHaveAttribute('data-spectrum-stats');
});
