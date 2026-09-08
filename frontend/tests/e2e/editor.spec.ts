import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const source = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><metadata><agent xmlns="http://www.w3.org/ns/ttml#metadata" xml:id="v1"/></metadata></head><body><div><p xml:id="plain" begin="0s" end="1s">原始文字</p><p xml:id="ruby" begin="1s" end="2s"><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span></p><x:unknown xmlns:x="urn:test">保留</x:unknown></div></body></tt>`;

async function upload(page: import("@playwright/test").Page) {
  await page.goto("/editor");
  await page.locator('input[type="file"]').setInputFiles({ name: "sample.ttml", mimeType: "application/xml", buffer: Buffer.from(source) });
  await expect(page.getByRole("cell", { name: "原始文字", exact: true })).toBeVisible();
}

test("imports, edits, undoes and downloads TTML while retaining Ruby", async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "属性" }).click();
  await page.getByLabel("正文").fill("修改文字");
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(page.getByLabel("正文")).toHaveValue("修改文字");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByLabel("正文")).toHaveValue("原始文字");
  await page.getByRole("button", { name: "重做" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载草稿" }).click();
  const xml = await readFile(await (await download).path(), "utf8");
  expect(xml).toContain("修改文字");
  expect(xml).toContain("きょう");
  expect(xml).toContain("urn:test");
});

test("saves a real checkpoint, restores it after reload, and keeps undo history", async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "属性" }).click();
  await page.getByLabel("正文").fill("检查点文字");
  await page.getByRole("button", { name: "应用修改" }).click();
  await page.getByRole("button", { name: "保存检查点" }).click();
  await expect(page.getByText("本地检查点已保存", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByText("已恢复本地检查点（含最近撤销历史）", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "检查点文字", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByLabel("正文")).toHaveValue("原始文字");
});
