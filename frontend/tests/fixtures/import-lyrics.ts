import type { Page } from '@playwright/test';
export async function importLyrics(page: Page, file: Parameters<ReturnType<Page['locator']>['setInputFiles']>[0]) {
 await page.getByRole('button', { name: '歌词获取', exact: true }).click();
 await page.getByRole('tab', { name: '文件', exact: true }).click();
 await page.locator('input[type=file][accept^=".ttml"]').setInputFiles(file);
 await page.getByRole('button', { name: '确认导入并替换歌词', exact: true }).click();
}
