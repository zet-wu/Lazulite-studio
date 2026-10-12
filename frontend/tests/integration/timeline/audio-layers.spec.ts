import { uploadFixtureMusic } from '../../fixtures/upload-music';
import { expect, test } from '@playwright/test';
import { mixedRubyKana } from '../../fixtures/ruby-kana';

for (const theme of ['light', 'dark']) test(`timeline geometry and hidden layers (${theme})`, async ({ page }) => {
 const asset = await uploadFixtureMusic(page);
  const response = await page.request.post('/api/v1/projects', { headers: { origin: 'http://127.0.0.1:5175' }, data: { name: 'Audio layer geometry', upload_id: asset } });
  const pid = (await response.json()).id;
  const before = await (await page.request.get(`/api/v1/projects/${pid}/document`)).json();
  const xml = mixedRubyKana;
  const saved = await page.request.put(`/api/v1/projects/${pid}/document`, { headers: { origin: 'http://127.0.0.1:5175', 'if-match': before.revision }, data: { schema_version: before.schema_version, project_id: pid, revision: before.revision, document: { ...before.document, lyrics: { draftTtml: xml } } } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await page.goto(`/projects/${pid}/edit`);

  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  await page.getByRole('button', { name: '分离人声', exact: true }).click();
  await expect(page.locator('[data-segment-id]').first()).toBeVisible({ timeout: 30000 });
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('button', { name: '声谱图', exact: true }).click();
  await expect(page.locator('[data-spectrum-ready]')).toHaveAttribute('data-spectrum-ready', '3');
  await expect(page.getByRole('button', { name: /^时间轴注音 / }).first()).toBeVisible();
  const measure = () => page.locator('#timeline-plots').evaluate(root => {
    const wave = root.querySelector('[aria-label="波形进度"]')!;
    const source = root.querySelector('select')!;
    const wr = wave.getBoundingClientRect(), sr = source.getBoundingClientRect();
    const rows = Array.from(root.querySelectorAll('[aria-label="波形进度"], [aria-label="人声能量"], [data-vocal-lane], [data-track-lane], canvas[aria-label="声谱图"]'));
    const visibleRows = rows.filter(e => e.getBoundingClientRect().height > 0);
    const rects = visibleRows.map(e => e.getBoundingClientRect());
    const labels = Array.from(root.querySelectorAll('[data-vocal-tracks] strong, [aria-label="可编辑时间轴"] div:has(> [data-track-lane]) > strong'));
    const sourceStyle = getComputedStyle(source);
    const textStart = sr.x + parseFloat(sourceStyle.borderLeftWidth) + parseFloat(sourceStyle.paddingLeft);
    return {
      center: Math.abs(wr.y + wr.height / 2 - sr.y - sr.height / 2),
      gaps: rects.slice(1).flatMap((r, i) => visibleRows[i + 1].closest('section[aria-label]') === visibleRows[i].closest('section[aria-label]') ? [r.y - rects[i].bottom] : []),
      aligned: rects.map(r => Math.abs(r.x - wr.x)),
      labels: labels.map(e => Math.abs(e.getBoundingClientRect().x + parseFloat(getComputedStyle(e).paddingLeft) - textStart)),
      bars: Array.from(root.querySelectorAll('[data-segment-id]')).map(e => e.getBoundingClientRect().height),
    };
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const initial = await measure();
  expect(initial.center).toBeLessThan(1);
  initial.gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  initial.aligned.forEach(delta => expect(delta).toBeLessThan(1));
  initial.labels.forEach(delta => expect(delta).toBeLessThan(1));
  initial.bars.forEach(height => expect(height).toBe(20));
  await page.screenshot({ path: test.info().outputPath(`audio-${theme}.png`) });
  await page.getByLabel('吸附', { exact: true }).uncheck();
  await page.getByRole('button', { name: '新建人声片段', exact: true }).click();
  const waveBox = (await page.getByRole('slider', { name: '波形进度', exact: true }).boundingBox())!;
  await page.mouse.move(waveBox.x + waveBox.width * .1, waveBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(waveBox.x + waveBox.width * .2, waveBox.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-segment-id]')).toHaveCount(2);
  const lane = page.locator('[data-vocal-lane]');
  expect((await lane.boundingBox())!.height).toBe(44);
  const selected = page.locator('[data-segment-id][aria-pressed=true]');
  const block = (await selected.boundingBox())!;
  await page.mouse.move(block.x + block.width / 2, block.y + 10);
  await page.mouse.down();
  await page.mouse.move(block.x + block.width / 2 + waveBox.width * .4, block.y + 10, { steps: 4 });
  expect((await lane.boundingBox())!.height).toBe(44);
  await page.mouse.up();
  expect((await lane.boundingBox())!.height).toBe(22);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await lane.boundingBox())!.height).toBe(44);
  (await measure()).gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  await page.screenshot({ path: test.info().outputPath(`overlap-${theme}.png`) });
  for (const name of ['能量', '片段', '空隙', '注音', '词', '行']) {
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
  await page.getByRole('button', { name: '波形', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const expand = page.getByRole('button', { name: '展开时间轴', exact: true });
  if (await expand.count()) await expand.click();
  for (const name of ['行', '词', '注音']) {
    const toggle = page.getByRole('button', { name, exact: true });
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  }
  (await measure()).gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  expect((await measure()).center).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath(`footer-${theme}.png`) });
  await page.route('**/pcm*', route => route.abort());
  await page.getByLabel('波形／声谱图音源', { exact: true }).selectOption('');
  await expect(page.getByRole('button', { name: '重试加载声谱图', exact: true })).toBeVisible();
  (await measure()).gaps.forEach(gap => expect(gap).toBeCloseTo(4, 0));
  await page.screenshot({ path: test.info().outputPath(`error-${theme}.png`) });
});
