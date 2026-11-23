import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../../frontend/src/adapters/project-codec';
import { createLyricDocument } from '../../frontend/src/domain/lyric-document';
import { createProjectDocument, type ProjectSnapshot } from '../../frontend/src/domain/project-document';
import { StudioClient, StudioHttpError } from '../src/client';
import { createToolRegistry } from '../src/mcp-server';
import { installXmlDomShim } from '../src/xml-shim';

installXmlDomShim();

function createStatefulServerClient(initialDoc = createProjectDocument(createLyricDocument(''))) {
  let currentRev = 1;
  let snapshot: ProjectSnapshot = serializeProject(initialDoc);
  const putRequests: Array<{ ifMatch: string | null; idemKey: string | null }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const revStr = `rev-${currentRev}`;

    if (path === '/api/v1/projects/p1/document' && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({
          schema_version: 'studio-document-v9',
          project_id: 'p1',
          revision: revStr,
          document: snapshot,
          source_asset_id: 'asset-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ETag: `"${revStr}"` } },
      );
    }

    if (path === '/api/v1/projects/p1/document' && init?.method === 'PUT') {
      const headers = new Headers(init.headers);
      const ifMatch = headers.get('If-Match');
      const idemKey = headers.get('Idempotency-Key');
      putRequests.push({ ifMatch, idemKey });
      if (ifMatch !== `"${revStr}"`) {
        return Response.json(
          { code: 'revision_conflict', message: 'stale', retryable: false, current_revision: revStr },
          { status: 412 },
        );
      }
      const body = JSON.parse(String(init.body)) as { document: ProjectSnapshot };
      snapshot = body.document;
      currentRev += 1;
      const nextRev = `rev-${currentRev}`;
      return new Response(JSON.stringify({ revision: nextRev }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: `"${nextRev}"` },
      });
    }

    if (path === '/api/v1/lyric-sources/search') {
      const { source } = JSON.parse(String(init?.body)) as { source: string };
      if (source === 'kugou') {
        return Response.json({ code: 'source_network', message: 'kugou timeout', retryable: true }, { status: 502 });
      }
      if (source === 'qqmusic') {
        return Response.json({
          items: [
            {
              source: 'qqmusic',
              id: '12345',
              title: 'Test Song',
              artists: ['Artist A'],
              album: 'Album A',
              duration_ms: 200000,
              songmid: null,
              songid: '12345',
            },
          ],
        });
      }
      return Response.json({
        items: [
          {
            source,
            id: `${source}-1`,
            title: 'Test Song',
            artists: ['Artist A'],
            album: 'Album A',
            duration_ms: 200000,
          },
        ],
      });
    }

    if (path === '/api/v1/lyric-sources/resolve') {
      const cand = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ ...cand, songmid: '001AbcMid' });
    }

    if (path === '/api/v1/lyric-sources/fetch') {
      const cand = JSON.parse(String(init?.body)) as { songmid?: string };
      expect(cand.songmid).toBe('001AbcMid');
      return Response.json({
        empty: false,
        format: 'lrc',
        content: '[00:01.00]Hello\n[00:03.00]World',
        translation: '[00:01.00]你好\n[00:03.00]世界',
        metadata: { title: ['Test Song'], artist: ['Artist A'], qqMusicId: ['001AbcMid'] },
      });
    }

    if (path === '/api/v1/projects/p1/embedded-lyrics') {
      return Response.json({
        candidates: [{ id: '0', label: 'lyrics · 1', format: 'lrc', content: '[00:01.00]Embedded' }],
      });
    }

    return Response.json({ code: 'not_found', message: 'Not found', retryable: false }, { status: 404 });
  };

  return {
    client: new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl }),
    getSnapshot: () => snapshot,
    getRevision: () => `rev-${currentRev}`,
    putRequests,
  };
}

describe('Milestone 3 tools: metadata, singers, search, fetch, embedded, import', () => {
  it('updates metadata & language via CAS without modifying lines, and respects expected_revision', async () => {
    const registry = createToolRegistry();
    const state = createStatefulServerClient();

    const res = (await registry.call(
      'update_metadata',
      {
        project_id: 'p1',
        language: 'ja',
        set: { title: ['夜に駆ける'], artist: ['YOASOBI'] },
      },
      { client: state.client },
    )) as Record<string, unknown>;

    expect(res).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      language: 'ja',
      metadata: { title: ['夜に駆ける'], artist: ['YOASOBI'] },
    });
    expect(state.putRequests[0]).toMatchObject({ ifMatch: '"rev-1"' });
    expect(state.putRequests[0].idemKey).toBeTruthy();

    // Delete a key and verify expected_revision mismatch raises 412.
    await expect(
      registry.call(
        'update_metadata',
        { project_id: 'p1', expected_revision: 'rev-1', delete_keys: ['artist'] },
        { client: state.client },
      ),
    ).rejects.toBeInstanceOf(StudioHttpError);

    const delRes = (await registry.call(
      'update_metadata',
      { project_id: 'p1', expected_revision: 'rev-2', delete_keys: ['artist'] },
      { client: state.client },
    )) as Record<string, unknown>;
    expect(delRes).toMatchObject({
      changed: true,
      previous_revision: 'rev-2',
      new_revision: 'rev-3',
      metadata: { title: ['夜に駆ける'] },
    });
  });

  it('manages singers with actorRef and enforces AMLL word-agent constraints', async () => {
    const registry = createToolRegistry();
    const initial = createProjectDocument(createLyricDocument('歌う'));
    initial.lyrics.lines[0].id = 'line-1';
    initial.lyrics.lines[0].words[0].id = 'w-1';
    initial.lineOrder = ['line-1'];
    initial.karaoke.lineGroups = { 'line-1': '' };
    const state = createStatefulServerClient(initial);

    const res = (await registry.call(
      'manage_singers',
      {
        project_id: 'p1',
        upsert_agents: [
          { id: 'actor_1', name: '幾田りら', type: 'person' },
          { id: 'char_1', name: 'ボーカル', type: 'character', actor_ref: 'actor_1' },
        ],
        line_assignments: [{ line_id: 'line-1', agent_refs: ['char_1'] }],
      },
      { client: state.client },
    )) as Record<string, unknown>;

    expect(res).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      assigned_lines: 1,
    });
    const parsed = parseProject(state.getSnapshot());
    expect(parsed.lyrics.agents).toEqual([
      { id: 'actor_1', name: '幾田りら', type: 'person' },
      { id: 'char_1', name: 'ボーカル', type: 'character', actorRef: 'actor_1' },
    ]);
    expect(parsed.lyrics.lines[0].agentRefs).toEqual(['char_1']);

    // Default AMLL has noWordAgents=true, so word-level agent assignment should be rejected cleanly.
    await expect(
      registry.call(
        'manage_singers',
        {
          project_id: 'p1',
          word_assignments: [{ line_id: 'line-1', word_id: 'w-1', agent_refs: ['char_1'] }],
        },
        { client: state.client },
      ),
    ).rejects.toThrow(/amll\.conflict\.noWordAgents/);
  });

  it('searches online sources, auto-resolves QQ mid on fetch, reads embedded, and imports with mode safety', async () => {
    const registry = createToolRegistry();
    const initial = createProjectDocument(createLyricDocument(''));
    initial.acoustics = { analysisId: 'ana-keep', segments: [{ id: 's1', beginMs: 0, endMs: 1000 }] };
    const state = createStatefulServerClient(initial);

    const search = (await registry.call(
      'search_online_lyrics',
      { query: 'Test Song' },
      { client: state.client },
    )) as { items: Array<Record<string, unknown>>; source_errors?: Record<string, string> };
    expect(search.items).toHaveLength(3);
    expect(search.source_errors?.kugou).toContain('kugou timeout');

    const qqCandidate = search.items.find((item) => item.source === 'qqmusic')!;
    const fetched = (await registry.call(
      'fetch_online_lyrics',
      { candidate: qqCandidate },
      { client: state.client },
    )) as Record<string, unknown>;
    expect(fetched).toMatchObject({
      empty: false,
      format: 'lrc',
      line_count: 2,
      translation: '[00:01.00]你好\n[00:03.00]世界',
    });

    const embedded = (await registry.call(
      'get_embedded_lyrics',
      { project_id: 'p1' },
      { client: state.client },
    )) as { candidates: Array<Record<string, unknown>> };
    expect(embedded.candidates[0].format).toBe('lrc');

    // First import with mode="replace_if_empty" succeeds on empty project and preserves acoustics.
    const imported = (await registry.call(
      'import_lyrics',
      {
        project_id: 'p1',
        content: fetched.content,
        format: fetched.format,
        mode: 'replace_if_empty',
        translation: fetched.translation,
        incoming_metadata: fetched.metadata,
      },
      { client: state.client },
    )) as Record<string, unknown>;
    expect(imported).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      line_count: 2,
      has_translations: true,
      metadata: { title: ['Test Song'], artist: ['Artist A'], qqMusicId: ['001AbcMid'] },
    });
    expect(parseProject(state.getSnapshot()).acoustics.analysisId).toBe('ana-keep');

    // Second import with mode="replace_if_empty" refuses to overwrite existing lyrics!
    await expect(
      registry.call(
        'import_lyrics',
        {
          project_id: 'p1',
          content: 'Line 1\nLine 2',
          format: 'txt',
          mode: 'replace_if_empty',
        },
        { client: state.client },
      ),
    ).rejects.toThrow(/replace_all/);

    // Explicit mode="replace_all" replaces with plain text.
    const replaced = (await registry.call(
      'import_lyrics',
      {
        project_id: 'p1',
        content: 'Line 1\nLine 2\nLine 3',
        format: 'txt',
        mode: 'replace_all',
        metadata_mode: 'keep_existing',
      },
      { client: state.client },
    )) as Record<string, unknown>;
    expect(replaced).toMatchObject({
      changed: true,
      line_count: 3,
      timed_lines: 0,
      metadata: { title: ['Test Song'], artist: ['Artist A'], qqMusicId: ['001AbcMid'] },
    });
  });

  it('replays identical write requests with the same idempotency_key, rejects mismatched params with 409, and keeps 412 for new keys', async () => {
    const registry = createToolRegistry();
    const state = createStatefulServerClient();

    const first = (await registry.call(
      'update_metadata',
      {
        project_id: 'p1',
        expected_revision: 'rev-1',
        idempotency_key: 'idem-meta-1',
        set: { title: ['Replay Title'], artist: ['Replay Artist'] },
      },
      { client: state.client },
    )) as Record<string, unknown>;

    expect(first).toMatchObject({
      changed: true,
      previous_revision: 'rev-1',
      new_revision: 'rev-2',
      metadata: { title: ['Replay Title'], artist: ['Replay Artist'] },
    });
    expect(state.putRequests).toHaveLength(1);

    // Same idempotency_key + same semantic args (different key order) replays original result without 412 or extra PUT.
    const replay = (await registry.call(
      'update_metadata',
      {
        idempotency_key: 'idem-meta-1',
        expected_revision: 'rev-1',
        set: { artist: ['Replay Artist'], title: ['Replay Title'] },
        project_id: 'p1',
      },
      { client: state.client },
    )) as Record<string, unknown>;

    expect(replay).toEqual(first);
    expect(state.putRequests).toHaveLength(1);

    // Same idempotency_key + different args returns 409 idempotency_mismatch.
    await expect(
      registry.call(
        'update_metadata',
        {
          project_id: 'p1',
          expected_revision: 'rev-1',
          idempotency_key: 'idem-meta-1',
          set: { title: ['Different Title'] },
        },
        { client: state.client },
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'idempotency_mismatch' },
    });

    // Different tool with same idempotency_key also returns 409 idempotency_mismatch.
    await expect(
      registry.call(
        'manage_singers',
        {
          project_id: 'p1',
          expected_revision: 'rev-1',
          idempotency_key: 'idem-meta-1',
        },
        { client: state.client },
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'idempotency_mismatch' },
    });

    // New idempotency_key with stale expected_revision still enforces 412 revision_conflict.
    await expect(
      registry.call(
        'update_metadata',
        {
          project_id: 'p1',
          expected_revision: 'rev-1',
          idempotency_key: 'idem-meta-2',
          set: { title: ['Another Title'] },
        },
        { client: state.client },
      ),
    ).rejects.toMatchObject({
      status: 412,
      body: { code: 'revision_conflict' },
    });
  });
});
