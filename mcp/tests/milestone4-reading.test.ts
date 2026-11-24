import { describe, expect, it, vi } from 'vitest';
import { parseProject, serializeProject } from '../../frontend/src/adapters/project-codec';
import { createLine, createLyricDocument, createWord } from '../../frontend/src/domain/lyric-document';
import { createProjectDocument, type ProjectDocument } from '../../frontend/src/domain/project-document';
import { StudioClient, StudioHttpError } from '../src/client';
import { createToolRegistry } from '../src/mcp-server';
import { installXmlDomShim } from '../src/xml-shim';

installXmlDomShim();

function createStatefulReadingClient(initialDoc: ProjectDocument) {
  let revision = 'rev-1';
  let snapshot = serializeProject(initialDoc);
  const putCalls: Array<{ ifMatch: string | null; idempotencyKey: string | null }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/projects/p1/document' && method === 'GET') {
      return new Response(
        JSON.stringify({
          schema_version: 'studio-document-v9',
          project_id: 'p1',
          revision,
          document: snapshot,
          source_asset_id: null,
        }),
        { status: 200, headers: { ETag: `"${revision}"` } },
      );
    }

    if (path === '/api/v1/projects/p1/document' && method === 'PUT') {
      const headers = new Headers(init?.headers);
      const ifMatch = headers.get('If-Match');
      const idempotencyKey = headers.get('Idempotency-Key');
      putCalls.push({ ifMatch, idempotencyKey });
      if (ifMatch !== `"${revision}"` && ifMatch !== revision) {
        return new Response(
          JSON.stringify({
            detail: {
              code: 'revision_conflict',
              message: 'Revision mismatch',
              retryable: false,
              current_revision: revision,
            },
          }),
          { status: 412 },
        );
      }
      const body = JSON.parse(String(init?.body)) as { document: typeof snapshot };
      snapshot = body.document;
      revision = `rev-${Number(revision.split('-')[1]) + 1}`;
      return new Response(JSON.stringify({ revision }), {
        status: 200,
        headers: { ETag: `"${revision}"` },
      });
    }

    if (path === '/api/v1/reading/analyze' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { lines: Array<{ id: string; text: string }> };
      return Response.json({
        ranges: body.lines.map((line) => ({
          line_id: line.id,
          base_start: 0,
          base_end: Array.from(line.text).length >= 2 ? 2 : Array.from(line.text).length,
          base: Array.from(line.text).slice(0, 2).join(''),
          reading: 'きょう',
        })),
      });
    }

    if (path === '/api/v1/reading/dictionaries' && method === 'GET') {
      return Response.json({
        dictionaries: [
          {
            id: 'zh-yue',
            instance: 'inst-1',
            manifest: { name: 'Cantonese Dict', version: '1.0.0', language: 'yue' },
            sources: [],
            error: null,
          },
        ],
        errors: [],
      });
    }

    if (path === '/api/v1/reading/dictionaries/zh-yue/analyze' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        instance: string;
        lines: Array<{ id: string; text: string }>;
      };
      return Response.json({
        instance: body.instance,
        version: '1.0.0',
        ranges: body.lines.map((line) => ({
          line_id: line.id,
          base_start: 0,
          base_end: Array.from(line.text).length,
          base: line.text,
          status: 'ambiguous',
          units: ['ceoi3', 'zoi6'],
        })),
      });
    }

    return new Response(JSON.stringify({ code: 'not_found', message: 'Not found', retryable: false }), {
      status: 404,
    });
  };

  return {
    client: new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl }),
    getCurrentDoc: () => parseProject(snapshot),
    getRevision: () => revision,
    putCalls,
  };
}

describe('Milestone 4 reading & dictionary tools', () => {
  it('analyzes Japanese and dictionary readings for selected lines', async () => {
    const lyrics = createLyricDocument('今日世界');
    lyrics.lines.push(createLine('明天', 'line-2'));
    const doc = createProjectDocument(lyrics);
    const { client } = createStatefulReadingClient(doc);
    const registry = createToolRegistry();
    const firstLineId = doc.lyrics.lines[0].id;
    const analyze = vi.spyOn(client, 'analyzeJapaneseReading');

    const jaResult = (await registry.call(
      'analyze_japanese_reading',
      { project_id: 'p1', line_ids: [firstLineId], auto_merge: true },
      { client },
    )) as {
      returned_lines: number;
      lines: Array<{ line_id: string; text: string; ranges: Array<{ base: string; reading: string }> }>;
    };
    expect(analyze).toHaveBeenCalledWith([{id:firstLineId,text:'今日世界'}], true);
    expect(jaResult.returned_lines).toBe(1);
    expect(jaResult.lines[0].line_id).toBe(firstLineId);
    expect(jaResult.lines[0].ranges[0]).toMatchObject({ base: '今日', reading: 'きょう' });

    const dicts = (await registry.call('list_dictionaries', {}, { client })) as {
      dictionaries: Array<{ id: string; instance: string; name: string; language: string }>;
    };
    expect(dicts.dictionaries[0]).toMatchObject({
      id: 'zh-yue',
      instance: 'inst-1',
      name: 'Cantonese Dict',
      language: 'yue',
    });

    const dictResult = (await registry.call(
      'analyze_dictionary_reading',
      { project_id: 'p1', dictionary_id: 'zh-yue', start_line: 2, limit: 1 },
      { client },
    )) as {
      instance: string;
      lines: Array<{ text: string; ranges: Array<{ status: string; units: string[] }> }>;
    };
    expect(dictResult.instance).toBe('inst-1');
    expect(dictResult.lines[0].text).toBe('明天');
    expect(dictResult.lines[0].ranges[0].status).toBe('ambiguous');
  });

  it('applies readings on untimed and timed lyrics, preserving timing, splitting/merging words, background lines, and emptyBeats', async () => {
    const lyrics = createLyricDocument('');
    const line1Id = lyrics.lines[0].id;
    lyrics.lines[0] = {
      ...lyrics.lines[0],
      beginMs: 1000,
      endMs: 2500,
      words: [
        { ...createWord('今日世界', 'w-compound'), beginMs: 1000, endMs: 1800 },
        { ...createWord('今', 'w-m1'), beginMs: 1800, endMs: 2000 },
        { ...createWord('日', 'w-m2'), beginMs: 2000, endMs: 2500 },
      ],
    };
    const line2Id = 'line-2';
    lyrics.lines.push({
      id: line2Id,
      beginMs: 2500,
      endMs: 4000,
      backgroundOf: null,
      agentRefs: [],
      songPart: null,
      words: [createWord('星', 'w-star')],
    });
    const bgLineId = 'line-bg';
    lyrics.lines.push({
      id: bgLineId,
      beginMs: 2600,
      endMs: 3200,
      backgroundOf: line2Id,
      agentRefs: [],
      songPart: null,
      words: [{ ...createWord('夜', 'w-bg'), beginMs: 2600, endMs: 3200 }],
    });

    const doc = createProjectDocument(lyrics);
    doc.amll.noWordAgents = false;
    doc.editing.emptyBeats = {
      'w-compound': { kind: 'word', count: 1 },
    };

    const { client, getCurrentDoc } = createStatefulReadingClient(doc);
    const registry = createToolRegistry();

    const applied = (await registry.call(
      'apply_readings',
      {
        project_id: 'p1',
        expected_revision: 'rev-1',
        operations: [
          {
            mode: 'set_line_spans',
            line_id: line1Id,
            spans: [
              { base_start: 0, base_end: 2, base: '今日', readings: ['きょう'] },
              { base_start: 2, base_end: 4, base: '世界', readings: ['せ', 'かい'] },
              { base_start: 4, base_end: 6, base: '今日', readings: ['きょ', 'う'] },
            ],
          },
          {
            mode: 'set_word',
            line_id: line2Id,
            word_id: 'w-star',
            readings: ['ほし'],
          },
          {
            mode: 'set_word',
            line_id: bgLineId,
            word_id: 'w-bg',
            readings: ['よる'],
          },
        ],
      },
      { client },
    )) as { previous_revision: string; new_revision: string; touched_line_count: number };

    expect(applied.previous_revision).toBe('rev-1');
    expect(applied.new_revision).toBe('rev-2');
    expect(applied.touched_line_count).toBe(3);

    const saved = getCurrentDoc();
    const savedLine1 = saved.lyrics.lines.find((l) => l.id === line1Id)!;
    expect(savedLine1.words.map((w) => w.text)).toEqual(['今日', '世界', '今日']);
    // Split timestamps proportionally preserved [1000..1400], [1400..1800], merged [1800..2500]
    expect(savedLine1.words[0]).toMatchObject({ beginMs: 1000, endMs: 1400 });
    expect(savedLine1.words[0].rubyUnits.map((u) => [u.reading, u.beginMs, u.endMs])).toEqual([['きょう', 1000, 1400]]);
    expect(savedLine1.words[1]).toMatchObject({ beginMs: 1400, endMs: 1800 });
    expect(savedLine1.words[1].rubyUnits.map((u) => u.reading)).toEqual(['せ', 'かい']);
    expect(savedLine1.words[1].rubyUnits[0].beginMs).toBe(1400);
    expect(savedLine1.words[1].rubyUnits[1].endMs).toBe(1800);
    expect(savedLine1.words[2]).toMatchObject({ beginMs: 1800, endMs: 2500 });
    expect(savedLine1.words[2].rubyUnits.map((u) => u.reading)).toEqual(['きょ', 'う']);

    // Empty beat preserved cleanly on split part0 ruby
    expect(saved.editing.emptyBeats['w-compound']).toBeUndefined();
    expect(saved.editing.emptyBeats[savedLine1.words[0].rubyUnits[0].id]).toEqual({ kind: 'ruby', count: 1 });

    // Untimed line word kept untimed
    const savedLine2 = saved.lyrics.lines.find((l) => l.id === line2Id)!;
    expect(savedLine2.words[0].rubyUnits[0]).toMatchObject({ reading: 'ほし', beginMs: null, endMs: null });

    // Background line word timed ruby kept within envelope
    const savedBg = saved.lyrics.lines.find((l) => l.id === bgLineId)!;
    expect(savedBg.words[0].rubyUnits[0]).toMatchObject({ reading: 'よる', beginMs: 2600, endMs: 3200 });

    // Overwriting without overwrite_existing=true is rejected cleanly
    await expect(
      registry.call(
        'apply_readings',
        {
          project_id: 'p1',
          operations: [{ mode: 'set_word', line_id: line2Id, word_id: 'w-star', readings: ['せい'] }],
        },
        { client },
      ),
    ).rejects.toThrowError(/overwrite_existing/);

    // Overwriting with overwrite_existing=true and clearing rubies preserves valid emptyBeats
    await registry.call(
      'apply_readings',
      {
        project_id: 'p1',
        overwrite_existing: true,
        operations: [
          { mode: 'set_word', line_id: line1Id, word_id: savedLine1.words[0].id, readings: [] },
        ],
      },
      { client },
    );
    const afterClear = getCurrentDoc();
    expect(afterClear.editing.emptyBeats).toEqual({});
  });

  it('rejects incompatible singer merges and 412 revision conflicts without corrupting state', async () => {
    const lyrics = createLyricDocument('');
    lyrics.agents = [
      { id: 'v1', name: null, type: 'person' },
      { id: 'v2', name: null, type: 'person' },
    ];
    const lineId = lyrics.lines[0].id;
    lyrics.lines[0].words = [
      { ...createWord('あ', 'wa'), agentRefs: ['v1'] },
      { ...createWord('い', 'wi'), agentRefs: ['v2'] },
    ];
    const doc = createProjectDocument(lyrics);
    doc.amll.noWordAgents = false;
    const { client, putCalls } = createStatefulReadingClient(doc);
    const registry = createToolRegistry();

    await expect(
      registry.call(
        'apply_readings',
        {
          project_id: 'p1',
          operations: [{ mode: 'merge_words', line_id: lineId, word_ids: ['wa', 'wi'], readings: ['あい'] }],
        },
        { client },
      ),
    ).rejects.toThrowError(/singer/i);
    expect(putCalls).toHaveLength(0);

    try {
      await registry.call(
        'apply_readings',
        {
          project_id: 'p1',
          expected_revision: 'rev-stale',
          operations: [{ mode: 'set_word', line_id: lineId, word_id: 'wa', readings: ['あ'] }],
        },
        { client },
      );
      expect.unreachable('should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(StudioHttpError);
      expect((err as StudioHttpError).status).toBe(412);
      expect((err as StudioHttpError).body.current_revision).toBe('rev-1');
    }
  });
});
