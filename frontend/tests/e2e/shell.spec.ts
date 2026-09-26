import { expect, test, type Page } from "@playwright/test";
import { readFile } from 'node:fs/promises';

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("searches, opens a project, selects a line, and switches compact panels", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto("/projects");
  await page.getByPlaceholder("搜索项目").fill("星の手紙");
  await page.getByRole("link", { name: /星の手紙/ }).click();
  await page.getByRole("button", { name: "2 遠い星を見上げて" }).click();
  await expect(page.getByText("已选行：遠い星を見上げて")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "审核", exact: true }).click();
  await expect(page.getByLabel("审核").getByText("审核", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "歌词编辑" })).toBeVisible();
  await expect(page.getByText("已选行：遠い星を見上げて")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('advances the sync cursor through a project without moving the audio on undo', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const panel = page.getByRole('region', { name: '连续打轴' });
  await expect(panel.getByText('打轴 1/6')).toBeVisible();
  await panel.getByRole('button', { name: '起始轴' }).click();
  await panel.getByRole('button', { name: '连续轴' }).click();
  await expect(panel.getByText('打轴 2/6')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  const position = await page.getByRole('slider', { name: '波形进度' }).getAttribute('aria-valuenow');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(panel.getByText('打轴 2/6')).toBeVisible();
  await expect(page.getByRole('slider', { name: '波形进度' })).toHaveAttribute('aria-valuenow', position!);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('records keyboard sync marks against one playing audio clock', async ({ page }) => {
  const wav = await readFile('../frontend/tests/fixtures/editor-beats.wav');
  await page.goto('/projects/sample-project/edit');
  await page.locator('audio').evaluate((element, source) => { const audio = element as HTMLAudioElement; audio.src = `data:audio/wav;base64,${source}`; audio.load(); }, wav.toString('base64'));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.keyboard.press('s');
  await page.waitForTimeout(120);
  await page.keyboard.press('d');
  await expect(page.getByRole('region', { name: '连续打轴' }).getByText('打轴 2/6')).toBeVisible();
  const end = Number(await page.getByRole('textbox', { name: '词 夜の風が静かに吹く结束秒数' }).inputValue());
  expect(end).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test('drags a timed word on the waveform tracks and undoes it once', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const start = page.getByRole('textbox', { name: '词 夜の風が静かに吹く开始秒数' });
  const end = page.getByRole('textbox', { name: '词 夜の風が静かに吹く结束秒数' });
  await start.fill('0'); await start.blur();
  await end.fill('5'); await end.blur();
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: '放大波形' }).click();
  const bar = page.getByRole('button', { name: '时间轴词 夜の風が静かに吹く' });
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(start).not.toHaveValue('0');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(start).toHaveValue('0');
  await expect(end).toHaveValue('5');
});

test('uses live PCM tiles for the spectrum and analyzes the beat', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const wav = await readFile('../frontend/tests/fixtures/editor-beats.wav');
  await page.locator('audio').evaluate((element, source) => { const audio = element as HTMLAudioElement; audio.src = `data:audio/wav;base64,${source}`; audio.load(); }, wav.toString('base64'));
  const wordStart = page.getByRole('textbox', { name: '词 夜の風が静かに吹く开始秒数' });
  const wordEnd = page.getByRole('textbox', { name: '词 夜の風が静かに吹く结束秒数' });
  await wordStart.fill('0'); await wordStart.blur();
  await wordEnd.fill('5'); await wordEnd.blur();
  await page.getByRole('button', { name: '自动 BPM' }).click();
  await expect(page.getByText('检测到 120 BPM')).toBeVisible();
  await page.getByRole('button', { name: '频谱' }).click();
  await expect(page.getByText('放大到 20 秒以内显示频谱')).toBeVisible();
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: '放大波形' }).click();
  await expect(page.getByLabel('实时频谱')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: '../docs/evidence/editor-e6/studio-timeline-spectrum-1440.png', fullPage: true });
});

test('renders the current draft in AMLL preview and returns to editing', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('region', { name: '动态歌词预览' })).toBeVisible();
  await expect(page.getByText('夜の風が静かに吹く').first()).toBeVisible();
  await page.getByText('遠い星を見上げて').first().click();
  await expect(page.getByRole('slider', { name: '波形进度' })).toHaveAttribute('aria-valuenow', '5');
  await page.getByRole('checkbox', { name: '翻译' }).uncheck();
  await page.getByRole('checkbox', { name: '音译' }).uncheck();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歌词编辑' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('previews Ruby, translation and background from a rich draft', async ({ page }) => {
  const source = await readFile('../docs/evidence/editor-e0/reference-apple-metadata.ttml');
  const wav = await readFile('../frontend/tests/fixtures/editor-beats.wav');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/projects/sample-project/edit');
  await page.locator('audio').evaluate((element, source) => { const audio = element as HTMLAudioElement; audio.src = `data:audio/wav;base64,${source}`; audio.load(); }, wav.toString('base64'));
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'rich.ttml', mimeType: 'application/xml', buffer: source });
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('region', { name: '动态歌词预览' })).toBeVisible();
  await expect(page.getByText('今天 也唱歌')).toBeVisible();
  await expect(page.getByText('響く')).toBeVisible();
  await expect(page.getByRole('region', { name: '动态歌词预览' }).getByText('きょ')).toBeVisible();
  await page.getByRole('region', { name: '动态歌词预览' }).getByText('今日').click();
  await expect(page.getByRole('slider', { name: '波形进度' })).toHaveAttribute('aria-valuenow', '1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../docs/evidence/editor-e7/studio-preview-rich-1440.png', fullPage: true });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const ruby = page.getByRole('textbox', { name: '读音 今日', exact: true }).first();
  await ruby.fill('きよう'); await ruby.blur();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Lazulite Studio' }).click();
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('textbox', { name: '读音 今日', exact: true }).first()).toHaveValue('きよう');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '最终 TTML' }).click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('きよう');
});

test("shows empty, error, expired, and loading states and can recover", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto("/projects?scenario=empty");
  await expect(page.getByText("还没有项目", { exact: true })).toBeVisible();

  await page.goto("/projects?scenario=error");
  await expect(page.getByText("项目暂时不可用", { exact: true })).toBeVisible();
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "重试", exact: true }).click();
  expect((await retryResponse).status()).toBe(503);
  await expect(page.getByText("项目暂时不可用", { exact: true })).toBeVisible();

  await page.goto("/projects?scenario=expired");
  await expect(
    page.getByRole("heading", { name: "登录 Lazulite Studio" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "返回模拟工作台", exact: true })
    .click();
  await expect(page.getByPlaceholder("搜索项目")).toBeVisible();

  await page.goto("/projects?scenario=loading");
  await expect(page.getByText("正在检查会话…", { exact: true })).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByPlaceholder("搜索项目")).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps deep edit navigation, task tabs, settings, and export state usable", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto("/projects/sample-project/edit?line=line-4");
  await expect(page.getByRole("heading", { name: "歌词编辑" })).toBeVisible();
  await expect(page.getByText("已选行：小さな願いを抱いて")).toBeVisible();
  await expect(page.getByText("审核", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "自动化任务" })
      .locator("strong")
      .filter({ hasText: "行对齐" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByText("document.edit", { exact: true })).toBeVisible();

  await page.goto("/projects/sample-project/export");
  await expect(
    page.getByRole("heading", { name: "发布与下载 · 星の手紙 · 合成示例" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载 TTML", exact: true }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 TTML", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("星の手紙 · 合成示例.ttml");
  expect(errors).toEqual([]);
});

test("saves a semantic project edit and reopens the saved revision", async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const word = page.getByRole('textbox', { name: '词 夜の風が静かに吹く', exact: true });
  await word.dblclick();
  await word.fill('夜の風が静かに歌う');
  await word.blur();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: 'Lazulite Studio' }).click();
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('textbox', { name: '词 夜の風が静かに歌う', exact: true })).toBeVisible();
});

test('keeps the playhead highlight separate from the selected line', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const canvas = page.locator('footer canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width * 7 / 120, y: box!.height / 2 } });
  await expect(page.locator('[data-line-id="line-1"]')).toHaveClass(/selectedLine/);
  await expect(page.locator('[data-line-id="line-2"]')).toHaveClass(/playheadLine/);
  await expect(page.locator('[data-line-id="line-2"]')).not.toHaveClass(/selectedLine/);
});

test('moves an untimed word across lines without changing line timing and restores it with undo', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('textbox', { name: '词 夜の風が静かに吹く', exact: true }).focus();
  await page.getByRole('button', { name: '词移下行' }).click();
  await expect(page.locator('[data-line-id="line-1"] [data-word-id]')).toHaveCount(0);
  await expect(page.locator('[data-line-id="line-2"]').getByRole('textbox', { name: '词 夜の風が静かに吹く', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '行 line-2开始秒数' })).toHaveValue('5');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="line-1"]').getByRole('textbox', { name: '词 夜の風が静かに吹く', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '行 line-2开始秒数' })).toHaveValue('5');
});

test('imports rich TTML, edits Ruby, undoes, saves and reopens it in a project', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const source = await readFile('../docs/evidence/editor-e0/reference-apple-metadata.ttml');
  await page.locator('input[type="file"]').setInputFiles({ name: 'reference.ttml', mimeType: 'application/ttml+xml', buffer: source });
  await page.getByRole('button', { name: '人工应用' }).click();
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  const ruby = page.getByRole('textbox', { name: '读音 今日', exact: true }).first();
  await ruby.fill('きよう');
  await ruby.blur();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '读音 今日', exact: true }).first()).toHaveValue('きょ');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: 'Lazulite Studio' }).click();
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('textbox', { name: '读音 今日', exact: true }).first()).toHaveValue('きよう');
  await expect(page.getByRole('textbox', { name: '翻译 1' })).toHaveValue('今天 也唱歌');
  await expect(page.getByRole('textbox', { name: '词 響く', exact: true })).toBeVisible();
});
