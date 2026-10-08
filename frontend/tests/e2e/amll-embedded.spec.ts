import { expect, test } from '@playwright/test';
test('embedded candidates preview separately, cancel and import through common history', async ({page}) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button',{name:'歌词获取',exact:true}).click();
  await page.getByRole('tab',{name:'内嵌',exact:true}).click();
  await page.getByRole('button',{name:'USLT · eng'}).click();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认导入并替换歌词'})).toHaveCount(0);
  await page.getByRole('button',{name:'USLT · jpn'}).click();
  await page.getByRole('button',{name:'确认导入并替换歌词'}).click();
  await expect(page.getByRole('textbox',{name:'词 別の歌詞',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'词 別の歌詞',exact:true})).toHaveCount(0);
});
