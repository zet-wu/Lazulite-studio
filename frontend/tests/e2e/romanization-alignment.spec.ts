import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { largeKana, longRuby, mixedRubyKana } from '../fixtures/ruby-kana';

async function geometry(dialog: Locator) {
  return dialog.locator('[data-source-word]').evaluateAll(words => words.map(word => {
    const rect = (element: Element, text = false) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = text && element.textContent ? range.getBoundingClientRect() : element.getBoundingClientRect();
      return { center: box.x + box.width / 2, top: box.y, height: box.height };
    };
    const body = word.querySelector('[class*=romanPreviewBody]')!;
    return {
      text: body.textContent, body: rect(body, true), word: rect(word),
      units: Array.from(word.querySelectorAll('[data-source-unit]')).map(source => ({
        source: rect(source.firstElementChild!, true),
        input: rect(Array.from(word.querySelectorAll('[data-generated-unit]')).find(input => input.getAttribute('data-generated-unit') === source.getAttribute('data-source-unit'))!.firstElementChild!),
      })),
    };
  }));
}

for (const width of [1280, 1440, 1920]) for (const theme of ['light', 'dark']) test(`注音 and kana preview align at ${width} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'mixed.ttml', mimeType: 'application/xml', buffer: Buffer.from(mixedRubyKana) });
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  const plain = await geometry(dialog);
  expect(plain.map(word => word.text)).toEqual(['粉', '雪', 'が', '空', 'か', 'ら']);
  for (const word of plain) {
    expect(Math.abs(word.body.top - plain[0].body.top)).toBeLessThan(1);
    expect(Math.abs(word.body.center - word.word.center)).toBeLessThan(1);
  }
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await expect(dialog.getByRole('textbox')).toHaveCount(9);
  const timed = await geometry(dialog);
  expect(await dialog.getByRole('textbox').evaluateAll(inputs => inputs.every(input => getComputedStyle(input).textAlign === 'center'))).toBe(true);
  for (const word of timed) {
    expect(Math.abs(word.body.top - timed[0].body.top)).toBeLessThan(1);
    expect(Math.abs(word.body.center - word.word.center)).toBeLessThan(1);
    for (const unit of word.units) expect(Math.abs(unit.source.center - unit.input.center)).toBeLessThan(1);
    if (word.units.length === 1) expect(Math.abs(word.body.center - word.units[0].input.center)).toBeLessThan(1);
  }
  await page.mouse.move(1, 1);
  await page.screenshot({ path: test.info().outputPath(`alignment-${width}-${theme}.png`) });
  await dialog.getByLabel('L1单元 1音译').fill('long edited romanization '.repeat(10));
  const edited = await geometry(dialog);
  for (const word of edited) for (const unit of word.units) expect(Math.abs(unit.source.center - unit.input.center)).toBeLessThan(1);
  expect(await dialog.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false);
  await writeFile(test.info().outputPath('alignment.json'), JSON.stringify({ width, theme, plain, timed, edited }, null, 2));
});

for (const [name, xml, count] of [['注音', longRuby(64), 64], ['kana', largeKana(1, 80), 80]] as const) test(`Long ${name} wraps source and romanization together`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'wrap.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await expect(dialog.getByRole('textbox')).toHaveCount(count);
  const checkRows = async () => {
    const rows = await dialog.locator('[data-preview-unit]').evaluateAll(slots => {
      const rows = new Map<number, number>();
      for (const slot of slots) {
        const source = slot.querySelector('[data-source-unit]')!.getBoundingClientRect();
        const input = slot.querySelector('input')!.getBoundingClientRect();
        const top = Math.round(source.top);
        rows.set(top, Math.max(rows.get(top) ?? 0, input.bottom));
      }
      return Array.from(rows, ([top, bottom]) => ({ top, bottom })).sort((a, b) => a.top - b.top);
    });
    expect(rows.length).toBeGreaterThan(2);
    for (let index = 1; index < rows.length; index++) expect(rows[index].top).toBeGreaterThan(rows[index - 1].bottom);
    return rows;
  };
  const rows = await checkRows();
  const input = dialog.getByLabel('L1单元 1音译'); await input.fill('long manual input '.repeat(10));
  await expect(input).toBeFocused(); await checkRows();
  if (name === '注音') await expect(dialog.getByText('長い正文', { exact: true })).toHaveCount(1);
  await dialog.getByLabel(`L1单元 ${count}音译`).fill('tail'); await checkRows();
  await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`alternating-${name}.png`) });
  await writeFile(test.info().outputPath(`alternating-${name}.json`), JSON.stringify({ count, rows }, null, 2));
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel(`音译单元 ${count}`, { exact: true })).toHaveValue('tail');
});
