import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeProject } from '../../frontend/src/adapters/project-codec';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLyricDocument } from '../../frontend/src/domain/lyric-document';
import { StudioClient } from '../src/client';
import { createMcpServer, createToolRegistry } from '../src/mcp-server';
import { startHttpMcpServer, type HttpServerHandle } from '../src/transports';
import { installXmlDomShim } from '../src/xml-shim';

installXmlDomShim();

function createMockStudioClient() {
  const doc = createProjectDocument(createLyricDocument('テスト歌詞'));
  doc.lyrics.metadata = { title: ['Sample'] };
  const snapshot = serializeProject(doc);
  const fetchImpl: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v1/projects') {
      return Response.json({
        schema_version: 'studio-project-list-v1',
        items: [{ schema_version: 'studio-project-v1', id: 'p1', name: 'Sample', updated_at: '2026-11-22T00:00:00Z' }],
        next_cursor: null,
      });
    }
    if (path === '/api/v1/projects/p1') {
      return Response.json({
        schema_version: 'studio-project-v1',
        id: 'p1',
        name: 'Sample',
        updated_at: '2026-11-22T00:00:00Z',
        asset: null,
      });
    }
    if (path === '/api/v1/projects/p1/document') {
      return Response.json({
        schema_version: 'studio-document-v9',
        project_id: 'p1',
        revision: 'rev-1',
        document: snapshot,
        source_asset_id: null,
      });
    }
    return new Response(JSON.stringify({ code: 'not_found', message: 'Not found', retryable: false }), { status: 404 });
  };
  return new StudioClient({ baseUrl: 'http://127.0.0.1:15173', fetchImpl });
}

describe('MCP Server transports', () => {
  const handles: HttpServerHandle[] = [];

  afterEach(async () => {
    while (handles.length) {
      await handles.pop()!.close();
    }
  });

  it('serves listTools and callTool over InMemoryTransport', async () => {
    const server = createMcpServer(createMockStudioClient(), createToolRegistry());
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual([
      'list_projects',
      'get_project_summary',
      'get_source_metadata',
      'get_lyrics',
      'update_metadata',
      'manage_singers',
      'search_online_lyrics',
      'fetch_online_lyrics',
      'get_embedded_lyrics',
      'import_lyrics',
      'analyze_japanese_reading',
      'list_dictionaries',
      'analyze_dictionary_reading',
      'apply_readings',
      'list_alignment_models',
      'preview_alignment',
      'start_alignment',
      'get_job_status',
      'cancel_job',
      'apply_alignment_result',
    ]);

    const result = await client.callTool({ name: 'get_lyrics', arguments: { project_id: 'p1' } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0].text);
    expect(payload.lines[0].text).toBe('テスト歌詞');

    await Promise.all([client.close(), server.close()]);
  });

  it('serves Streamable HTTP MCP over loopback 127.0.0.1', async () => {
    const studioClient = createMockStudioClient();
    const registry = createToolRegistry();
    const handle = await startHttpMcpServer(() => createMcpServer(studioClient, registry), {
      host: '127.0.0.1',
      port: 0,
    });
    handles.push(handle);

    const health = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(health.status).toBe(200);

    const mcpClient = new Client({ name: 'http-test-client', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    await mcpClient.connect(transport);

    const result = await mcpClient.callTool({ name: 'list_projects', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0].text);
    expect(payload.items[0].id).toBe('p1');

    await mcpClient.close();
  });

  it('refuses non-loopback HTTP bind hosts', async () => {
    const studioClient = createMockStudioClient();
    const registry = createToolRegistry();
    await expect(
      startHttpMcpServer(() => createMcpServer(studioClient, registry), { host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow(/non-loopback/);
  });
});
