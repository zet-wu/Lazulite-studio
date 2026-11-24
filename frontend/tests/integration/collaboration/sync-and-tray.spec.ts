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
    editing: { emptyBeats: {}, ignoredSyncLineIds: [], skippedAlignmentLineIds: [] },
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

  // Drag floating tray from blank padding and confirm it stays inside viewport and resets on double-click.
  const tray = page.locator('[data-floating-tray]');
  const handle = tray.locator('[data-tray-handle]');
  const trayBoxBefore = (await tray.boundingBox())!;
  await page.mouse.move(trayBoxBefore.x + 4, trayBoxBefore.y + 4);
  await page.mouse.down();
  await page.mouse.move(trayBoxBefore.x - 120, trayBoxBefore.y - 80, { steps: 4 });
  await page.mouse.up();
  const trayBoxAfter = (await tray.boundingBox())!;
  expect(trayBoxAfter.x).toBeLessThan(trayBoxBefore.x);
  expect(trayBoxAfter.y).toBeLessThan(trayBoxBefore.y);
  await handle.dblclick({ position: { x: 4, y: 4 } });

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

test('recovers unacknowledged background alignment result across reload and prevents duplicate prompts', async ({ page }) => {
  const initial = await (await page.request.get(docUrl)).json();
  const baseXml =
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="l1"><span studio:id="w1">Hello</span></p></body></tt>';
  const baseSnapshot = {
    ...initial.document,
    karaoke: { ...initial.document.karaoke, lineGroups: { l1: 'main' }, cues: [] },
    lyrics: { draftTtml: baseXml },
    lineOrder: [],
    editing: { emptyBeats: {}, ignoredSyncLineIds: [], skippedAlignmentLineIds: [] },
    acoustics: { analysisId: null, segments: [] },
  };
  const reset = await page.request.put(docUrl, {
    headers: { origin: 'http://127.0.0.1:5175', 'if-match': initial.revision },
    data: { schema_version: initial.schema_version, project_id: pid, revision: initial.revision, document: baseSnapshot },
  });
  expect(reset.ok()).toBeTruthy();
  const rev = (await reset.json()).revision;

  const projectInfo = await (await page.request.get(`/api/v1/projects/${pid}`)).json();
  const assetId = projectInfo.asset.id as string;

  let ackedState: string | null = null;
  let resultRev = rev;

  await page.route(`**/api/v1/projects/${pid}/jobs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 'studio-job-list-v1',
        items: [
          {
            schema_version: 'studio-job-v1',
            id: 'bg-align-job-1',
            project_id: pid,
            kind: 'alignment',
            status: 'succeeded',
            stage: 'done',
            acknowledged_state: ackedState,
            request: { revision: resultRev, asset_id: assetId },
            result_available: true,
            error: null,
            engine: null,
            created_at: '2026-11-22T00:00:00Z',
            updated_at: '2026-11-22T00:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/jobs/bg-align-job-1/result', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 'studio-job-result-v1',
        job_id: 'bg-align-job-1',
        kind: 'alignment',
        binding: { project_id: pid, revision: resultRev, asset_id: assetId },
        alignment: {
          schema: 'lazulite-japanese-result-v1',
          units: [
            {
              unit_id: 'u1',
              line_id: 'l1',
              proposed_timing: { start: { time: 0.5, source: 'm' }, end: { time: 1.5, source: 'm' } },
            },
          ],
        },
        mapping: [{ unit_id: 'u1', object_id: 'w1', word_id: 'w1', line_id: 'l1', kind: 'word' }],
        scope: [{ object_id: 'w1', word_id: 'w1', line_id: 'l1', kind: 'word', target_ids: ['u1'] }],
        acoustics: null,
      }),
    });
  });

  await page.route('**/api/v1/jobs/bg-align-job-1/acknowledge', async (route) => {
    const body = route.request().postDataJSON() as { state: string };
    ackedState = body.state;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 'studio-job-v1',
        id: 'bg-align-job-1',
        project_id: pid,
        kind: 'alignment',
        status: 'succeeded',
        stage: 'done',
        acknowledged_state: ackedState,
        request: { revision: resultRev, asset_id: assetId },
        result_available: true,
        error: null,
      }),
    });
  });

  await page.goto(`/projects/${pid}/edit`);
  await expect(page.getByRole('status').filter({ hasText: '后台自动对齐已完成' })).toBeVisible();
  await page.getByRole('button', { name: '应用对齐结果', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已更新歌词时间' })).toBeVisible();
  expect(ackedState).toBe('applied');

  // Reloading after apply does NOT re-prompt
  await page.reload();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByText('后台自动对齐已完成')).toHaveCount(0);

  // Stale result on outdated revision shows warning & dismisses cleanly
  ackedState = null;
  resultRev = 'stale-old-revision';
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: '后台自动对齐结果已过期' })).toBeVisible();
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(page.getByText('后台自动对齐结果已过期')).toHaveCount(0);
  expect(ackedState).toBe('dismissed');
});
