import { expect, test, type Page } from '@playwright/test';
async function speed(page: Page, rate: number) {
  await page.getByRole('slider', { name: '播放速度', exact: true }).evaluate((element: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, rate);
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(rate);
}
test('speed slider updates immediately; wheel preserves focus and preferences stay outside history', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const control = page.getByRole('slider', { name: '播放速度', exact: true }); await expect(control).toBeEnabled();
  await speed(page, 1);
  const play = page.getByRole('button', { name: '播放', exact: true }); await play.focus();
  await control.dispatchEvent('wheel', { deltaY: -40, deltaMode: 0 });
  expect(Number(await control.inputValue())).toBeGreaterThan(1);
  await expect(play).toBeFocused();
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  expect(Number(await control.inputValue())).toBeGreaterThan(.8);
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(Number(await control.inputValue()));
  await page.mouse.up();
  const position = await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime);
  await page.getByRole('button', { name: '恢复 1 倍速度' }).click(); await expect(control).toHaveValue('1');
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(position);
  await speed(page, .25); await page.reload(); await expect(control).toHaveValue('0.25');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByLabel('可编辑时间轴').dispatchEvent('wheel', { deltaY: -100, deltaMode: 0 }); await expect(control).toHaveValue('0.25');
});
