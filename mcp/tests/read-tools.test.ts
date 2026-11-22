import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeProject } from '../../frontend/src/adapters/project-codec';
import { createKaraoke } from '../../frontend/src/domain/karaoke';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { discoverStudioBaseUrl, StudioClient, StudioHttpError } from '../src/client';
import { createToolRegistry } from '../src/mcp-server';
import { installXmlDomShim } from '../src/xml-shim';

installXmlDomShim();

function buildFixtureSnapshot() {
  const project = createProjectDocument();
  project.lyrics.language = 'ja';
  project.lyrics.metadata = { title: ['夜に駆ける'], artist: ['YOASOBI'] };
  project.lyrics.agents = [{ id: 'v1', name: 'ikura', type: 'person' }];

  const line1 = createLine('', 'line-1');
  line1.beginMs = 1000;
  line1.endMs = 3000;
  line1.agentRefs = ['v1'];
  line1.words = [
    {
      ...createWord('夜', 'w-1'),
      beginMs: 1000,
      endMs: 2000,
      rubyUnits: [{ id: 'r-1', reading: 'よる', beginMs: 1000, endMs: 2000 }],
    },
    { ...createWord('に', 'w-2'), beginMs: 2000, endMs: 3000 },
  ];

  const bg = createLine('', 'line-1-bg');
  bg.backgroundOf = 'line-1';
  bg.beginMs = 2100;
  bg.endMs = 2900;
  bg.words = [{ ...createWord('ah', 'w-bg'), beginMs: 2100, endMs: 2900 }];

  const line2 = createLine('駆ける', 'line-2');
  line2.beginMs = 3500;
  line2.endMs = 5000;

  project.lyrics.lines = [line1, bg, line2];
  project.karaoke = createKaraoke(project.lyrics);
  project.lineOrder = ['line-1', 'line-1-bg', 'line-2'];
  project.editing.skippedAlignmentLineIds = ['line-1-bg'];
  project.editing.emptyBeats = { 'r-1': { kind: 'ruby', count: 1 } };
  project.acoustics = { analysisId: 'ana-1', segments: [{ id: 'seg-1', beginMs: 900, endMs: 5100 }] };
  return serializeProject(project);
}

function createFakeClient(snapshot = buildFixtureSnapshot()) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/api/v1/projects') {
      return Response.json({
        schema_version: 'studio-project-list-v1',
        items: [{ schema_version: 'studio-project-v1', id: 'p1', name: 'Song 1', updated_at: '2026-11-22T00:00:00Z' }],
        next_cursor: null,
      });
    }
    if (path === '/api/v1/projects/p1') {
      return Response.json({
        schema_version: 'studio-project-v1',
        id: 'p1',
        name: 'Song 1',
        updated_at: '2026-11-22T00:00:00Z',
        asset: {
          schema_version: 'studio-asset-v1',
          id: 'asset-1',
          filename: 'song.flac',
          content_type: 'audio/flac',
          size_bytes: 12345,
          duration_ms: 180000,
          source_duration_ms: 180000,
          status: 'ready',
          asset_hash: 'abc',
          source_start_ms: 0,
          proxy_offset_ms: 0,
        },
      });
    }
    if (path === '/api/v1/projects/p1/document') {
      return new Response(
        JSON.stringify({
          schema_version: 'studio-document-v9',
          project_id: 'p1',
          revision: 'rev-1',
          document: snapshot,
          source_asset_id: 'asset-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"rev-1"' } },
      );
    }
    if (path === '/api/v1/projects/p1/jobs') {
      return Response.json({
        schema_version: 'studio-job-list-v1',
        items: [
          {
            schema_version: 'studio-job-v1',
            id: 'job-1',
            project_id: 'p1',
            kind: 'alignment',
            status: 'running',
            stage: 'decode',
            request: {},
            result_available: false,
            error: null,
            engine: null,
            created_at: '2026-11-22T00:00:00Z',
            updated_at: '2026-11-22T00:00:05Z',
          },
        ],
      });
    }
    if (path === '/api/v1/capabilities') {
      return Response.json({
        schema_version: 'studio-capabilities-v1',
        items: [{ id: 'job.alignment', enabled: true, reason: null }],
      });
    }
    if (path === '/api/v1/projects/p1/source-metadata') {
      return Response.json({
        asset_id: 'asset-1',
        conditions: { title: '夜に駆ける', artist: 'YOASOBI', album: 'THE BOOK' },
      });
    }
    if (path === '/api/v1/projects/p1/search-conditions') {
      return Response.json({ title: '夜に駆ける', artist: 'YOASOBI', album: '' });
    }
    return new Response(JSON.stringify({ code: 'not_found', message: 'Not found', retryable: false }), { status: 404 });
  };
  return {
    calls,
    client: new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl }),
  };
}

describe('StudioClient and read tools', () => {
  it('discovers base URL from identity.json or explicit options', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-id-'));
    try {
      mkdirSync(join(dir, 'runtime'), { recursive: true });
      writeFileSync(join(dir, 'runtime/identity.json'), JSON.stringify({ port: 15999 }), 'utf-8');
      expect(discoverStudioBaseUrl({ dataDir: dir })).toEqual({
        baseUrl: 'http://127.0.0.1:15999',
        source: join(dir, 'runtime/identity.json'),
      });
      expect(discoverStudioBaseUrl({ baseUrl: 'http://127.0.0.1:8000/' })).toEqual({
        baseUrl: 'http://127.0.0.1:8000',
        source: 'configured',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('authenticates in password mode and attaches session cookie + CSRF header', async () => {
    let loggedIn = false;
    let seenCsrf = '';
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/session' && init?.method === 'POST') {
        loggedIn = true;
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: [
            ['Content-Type', 'application/json'],
            ['Set-Cookie', 'studio_session=sess123; HttpOnly; Path=/'],
            ['Set-Cookie', 'studio_csrf=csrf456; Path=/'],
          ],
        });
      }
      const headers = new Headers(init?.headers);
      if (!loggedIn) {
        return Response.json({ code: 'unauthorized', message: 'session required', retryable: false }, { status: 401 });
      }
      seenCsrf = headers.get('X-CSRF-Token') ?? '';
      return Response.json({ schema_version: 'studio-project-list-v1', items: [], next_cursor: null });
    };
    const client = new StudioClient({ baseUrl: 'http://127.0.0.1:8000', password: 'secret', fetchImpl });
    const res = await client.listProjects();
    expect(res.items).toEqual([]);
    expect(seenCsrf).toBe('csrf456');
  });

  it('surfaces StudioHttpError with current_revision on 412 conflicts', async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json(
        { detail: { code: 'revision_conflict', message: 'stale', retryable: false, current_revision: 'rev-2' } },
        { status: 412 },
      );
    const client = new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl });
    await expect(client.saveDocument('p1', buildFixtureSnapshot(), 'rev-1')).rejects.toMatchObject({
      name: 'StudioHttpError',
      status: 412,
      body: expect.objectContaining({ code: 'revision_conflict', current_revision: 'rev-2' }),
    });
  });

  it('executes list_projects, get_project_summary, get_source_metadata, and paginated get_lyrics', async () => {
    const registry = createToolRegistry();
    const { client } = createFakeClient();

    const projects = (await registry.call('list_projects', {}, { client })) as { items: Array<Record<string, unknown>> };
    expect(projects.items).toHaveLength(1);
    expect(projects.items[0]).toMatchObject({
      id: 'p1',
      name: 'Song 1',
      current_revision: 'rev-1',
      duration_ms: 180000,
      has_source_audio: true,
      has_acoustics: true,
      line_count: 3,
    });

    const summary = (await registry.call('get_project_summary', { project_id: 'p1' }, { client })) as Record<string, unknown>;
    expect(summary).toMatchObject({
      project_id: 'p1',
      revision: 'rev-1',
      language: 'ja',
      metadata: { title: ['夜に駆ける'], artist: ['YOASOBI'] },
      counts: { total_lines: 3, main_lines: 2, background_lines: 1, ruby_words: 1 },
      acoustics: { analysis_id: 'ana-1', segment_count: 1 },
    });

    const meta = (await registry.call('get_source_metadata', { project_id: 'p1' }, { client })) as Record<string, unknown>;
    expect(meta).toMatchObject({
      has_source_audio: true,
      source_tags: { title: '夜に駆ける', artist: 'YOASOBI', album: 'THE BOOK' },
      search_conditions: { title: '夜に駆ける', artist: 'YOASOBI', album: '' },
    });

    const page1 = (await registry.call('get_lyrics', { project_id: 'p1', start_line: 1, limit: 2 }, { client })) as {
      total_lines: number;
      has_more: boolean;
      lines: Array<Record<string, unknown>>;
    };
    expect(page1.total_lines).toBe(3);
    expect(page1.has_more).toBe(true);
    expect(page1.lines[0]).toMatchObject({
      line_number: 1,
      line_id: 'line-1',
      text: '夜に',
      skip_alignment: false,
      words: [
        expect.objectContaining({
          word_id: 'w-1',
          ruby_units: [expect.objectContaining({ ruby_id: 'r-1', empty_beat_count: 1 })],
        }),
        expect.objectContaining({ word_id: 'w-2' }),
      ],
    });
    expect(page1.lines[1]).toMatchObject({
      line_number: 2,
      line_id: 'line-1-bg',
      background_of: 'line-1',
      skip_alignment: true,
    });

    const page2 = (await registry.call('get_lyrics', { project_id: 'p1', start_line: 3, limit: 2 }, { client })) as {
      has_more: boolean;
      lines: Array<Record<string, unknown>>;
    };
    expect(page2.has_more).toBe(false);
    expect(page2.lines[0]).toMatchObject({ line_number: 3, line_id: 'line-2', text: '駆ける' });
  });
});
