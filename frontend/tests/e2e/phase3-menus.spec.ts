import { expect, test } from '@playwright/test';

test('P3-08 leaving an inactive trigger does not dismiss the active keyboard menu', async ({ page }) => {
  await page.goto('/editor');
  const file = page.locator('[data-top-menu="view"]');
  await file.locator('summary').focus(); await page.keyboard.press('Enter');
  const tools = (await page.locator('[data-top-menu="tools"] summary').boundingBox())!;
  await page.mouse.move(tools.x + 8, tools.y + 8); await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await expect(file).toHaveAttribute('open', '');
});

