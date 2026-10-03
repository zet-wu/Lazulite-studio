import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) test(`timeline geometry and hidden layers (${theme})`, async ({ page }) => {
  const asset = (await (await page.request.get('/api/v1/projects/phase0-packaging')).json()).asset.id;
  const response = await page.request.post('/api/v1/projects', { headers: { origin: 'http://127.0.0.1:5175' }, data: { name: 'Phase 4 geometry', source_asset_id: asset } });
  const pid = (await response.json()).id;
  await page.goto(`/projects/${pid}/edit`);
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  await page.getByRole('button', { name: '分离人声', exact: true }).click();
  await expect(page.locator('[data-segment-id]').first()).toBeVisible({ timeout: 30000 });
  const measure = () => page.locator('#timeline-plots').evaluate(root => {
    const wave = root.querySelector('[aria-label="波形进度"]')!;
    const source = root.querySelector('select')!;
    const wr = wave.getBoundingClientRect(), sr = source.getBoundingClientRect();
    const rows = Array.from(root.querySelectorAll('[aria-label="波形进度"], [aria-label="人声能量"], [data-vocal-lane], [data-track-lane], canvas[aria-label="声谱图"]'));
    const rects = rows.map(e => e.getBoundingClientRect()).filter(r => r.height > 0);
    const labels = Array.from(root.querySelectorAll('[data-vocal-tracks] strong, [aria-label="可编辑时间轴"] strong'));
    const sourceStyle = getComputedStyle(source);
    const textStart = sr.x + parseFloat(sourceStyle.borderLeftWidth) + parseFloat(sourceStyle.paddingLeft);
    return {
      center: Math.abs(wr.y + wr.height / 2 - sr.y - sr.height / 2),
      gaps: rects.slice(1).map((r, i) => r.y - rects[i].bottom),
      aligned: rects.map(r => Math.abs(r.x - wr.x)),
      labels: labels.map(e => Math.abs(e.getBoundingClientRect().x + parseFloat(getComputedStyle(e).paddingLeft) - textStart)),
      bars: Array.from(root.querySelectorAll('[data-segment-id]')).map(e => e.getBoundingClientRect().height),
    };
  });
  const initial = await measure();
  expect(initial.center).toBeLessThan(1);
  initial.gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  initial.aligned.forEach(delta => expect(delta).toBeLessThan(1));
  initial.labels.forEach(delta => expect(delta).toBeLessThan(1));
  initial.bars.forEach(height => expect(height).toBe(20));
  await page.screenshot({ path: test.info().outputPath(`audio-${theme}.png`) });
  for (const name of ['能量', '片段', '行', '词', '注音', '空隙']) {
    const toggle = page.getByRole('button', { name, exact: true });
    if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
    (await measure()).gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  }
  await page.getByRole('button', { name: '波形', exact: true }).click();
  await expect(page.getByLabel('波形／声谱图音源', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建人声片段', exact: true }).click();
  expect((await measure()).center).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath(`hidden-${theme}.png`) });
});
