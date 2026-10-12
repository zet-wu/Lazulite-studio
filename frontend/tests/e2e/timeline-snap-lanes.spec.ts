import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';

const xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
  [[0,2], [1,3], [5,6], [6,7], [7,8], [8,9]].map(([begin,end], i) => `<p xml:id="t${i}" begin="${begin}" end="${end}"><span begin="${begin}" end="${end}">行${i}</span></p>`).join('') + '</div></body></tt>';

test('timeline snap affects line moves and boundary resize while later touching lines reuse the lowest free lane', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'snap.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const lines = page.locator('[data-outline-drag]'); await expect(lines).toHaveCount(6);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形', exact: true }).click();
  const third = page.getByRole('button', { name: '时间轴行 L3', exact: true });
  const fourth = page.getByRole('button', { name: '时间轴行 L4', exact: true });
  expect(await third.evaluate(e => getComputedStyle(e).top)).toBe('1px');
  expect(await fourth.evaluate(e => getComputedStyle(e).top)).toBe('1px');
  await lines.nth(4).click();
  const start = page.getByRole('textbox', { name: '行 5开始秒数', exact: true });
  const bar = page.getByRole('button', { name: '时间轴行 L5', exact: true });
  const move = async () => {
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + box.width * .49, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  };
  await page.getByLabel('吸附', { exact: true }).check(); await move(); await expect(start).toHaveValue('7.5');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(start).toHaveValue('7');
  await page.getByLabel('吸附', { exact: true }).uncheck(); await move();
  expect(Math.abs(Number(await start.inputValue()) - 7.49)).toBeLessThan(.002);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByLabel('吸附', { exact: true }).check(); await lines.nth(3).click();
  const end = page.getByRole('textbox', { name: '行 4结束秒数', exact: true });
  const handle = fourth.getByLabel('时间轴行 L4结束边界'); const box = (await fourth.boundingBox())!, edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + box.width * 1.49, edge.y + edge.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(end).toHaveValue('8.5');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(end).toHaveValue('7');
});
