import { expect, test } from '@playwright/test';

const pid = 'music-packaging';
const docUrl = `/api/v1/projects/${pid}/document`;

test('real SSE syncs external edits when clean, warns when dirty without layout shift, and tray is draggable', async ({ page }) => {
  const initial = await (await page.request.get(docUrl)).json();
  const baseXml =
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a"><span studio:id="w1">initial</span></p></body></tt>';
  const baseSnapshot = {
    ...initial.document,
    karaoke: { ...initial.document.karaoke, lineGroups: { a: 'main' }, cues: [] },
    lyrics: { draftTtml: baseXml },
    lineOrder: [],
    editing: { emptyBeats: {}, ignoredSyncLineIds: [], skippedAlignmentLineIds: [], endLinks: {} },
    acoustics: { analysisId: null, segments: [] },
  };
  const reset = await page.request.put(docUrl, {
    headers: { origin: 'http://127.0.0.1:5175', 'if-match': initial.revision },
    data: { schema_version: initial.schema_version, project_id: pid, revision: initial.revision, document: baseSnapshot },
  });
  expect(reset.ok()).toBeTruthy();
  const rev1 = (await reset.json()).revision;

  await page.goto(`/projects/${pid}/edit`);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const nav = page.locator('nav[aria-label="工作模式"]');
  const navTopBefore = (await nav.boundingBox())!.y;

  // External revision while !dirty auto-syncs via SSE and keeps nav top position stable.
  const externalXml =
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a"><span studio:id="w1">external-v2</span></p></body></tt>';
  const extSave = await page.request.put(docUrl, {
    headers: { origin: 'http://127.0.0.1:5175', 'if-match': rev1 },
    data: {
      schema_version: initial.schema_version,
      project_id: pid,
      revision: rev1,
      document: { ...baseSnapshot, lyrics: { draftTtml: externalXml } },
    },
  });
  expect(extSave.ok()).toBeTruthy();
  const rev2 = (await extSave.json()).revision;

  await expect(page.getByRole('status').filter({ hasText: '项目已由外部工具更新并同步' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '词 external-v2', exact: true })).toBeVisible();
  expect((await nav.boundingBox())!.y).toBe(navTopBefore);

  // Drag floating tray and confirm it stays inside viewport and updates position.
  const tray = page.locator('[data-floating-tray]');
  const handle = tray.locator('[data-tray-handle]');
  const trayBoxBefore = (await tray.boundingBox())!;
  await page.mouse.move(trayBoxBefore.x + 24, trayBoxBefore.y + 14);
  await page.mouse.down();
  await page.mouse.move(trayBoxBefore.x - 120, trayBoxBefore.y - 80, { steps: 4 });
  await page.mouse.up();
  const trayBoxAfter = (await tray.boundingBox())!;
  expect(trayBoxAfter.x).toBeLessThan(trayBoxBefore.x);
  expect(trayBoxAfter.y).toBeLessThan(trayBoxBefore.y);
  await handle.dblclick();

  // Dirty local state warns on external update and supports reloading external version.
  const wordInput = page.getByRole('textbox', { name: '词 external-v2', exact: true });
  await wordInput.fill('local-unsaved');
  await wordInput.blur();

  const externalXml3 =
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a"><span studio:id="w1">external-v3</span></p></body></tt>';
  const extSave3 = await page.request.put(docUrl, {
    headers: { origin: 'http://127.0.0.1:5175', 'if-match': rev2 },
    data: {
      schema_version: initial.schema_version,
      project_id: pid,
      revision: rev2,
      document: { ...baseSnapshot, lyrics: { draftTtml: externalXml3 } },
    },
  });
  expect(extSave3.ok()).toBeTruthy();

  await expect(page.getByRole('alert').filter({ hasText: '检测到外部更新，当前有未保存修改' })).toBeVisible();
  await page.getByRole('button', { name: '重新加载外部版本', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '词 external-v3', exact: true })).toBeVisible();
});
