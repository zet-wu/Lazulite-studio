import {expect, type Page} from '@playwright/test';
export async function openLanguage(page: Page) {
 await page.locator('[data-settings-button]').click();
 return page.getByRole('dialog');
}
export async function chooseLanguage(page: Page, language: string) {
 const dialog=await openLanguage(page);
 await dialog.locator(`input[value="${language}"]`).check();
 await expect(page.locator('html')).toHaveAttribute('lang',language==='zh-Hans'?'zh-Hans':language==='zh-Hant'?'zh-Hant-TW':'en');
 await page.keyboard.press('Escape');
}
