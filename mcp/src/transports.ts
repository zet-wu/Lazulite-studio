import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function runStdioServer(createServerInstance: () => McpServer): Promise<void> {
  const server = createServerInstance();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8').trim();
      if (!text) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function writeJsonError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
  );
}

export type HttpServerHandle = {
  server: Server;
  url: string;
  port: number;
  close: () => Promise<void>;
};

export async function startHttpMcpServer(
  createServerInstance: () => McpServer,
  options: { host?: string; port?: number; path?: string } = {},
): Promise<HttpServerHandle> {
  const host = options.host ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Refusing to bind MCP HTTP server to non-loopback host: ${host}`);
  }
  const mcpPath = options.path ?? '/mcp';
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  const httpServer = createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${host}`);
    if (reqUrl.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }

    if (reqUrl.pathname !== mcpPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (sessionId) {
          const existing = sessions.get(sessionId);
          if (!existing) {
            writeJsonError(res, 404, -32001, 'Unknown MCP session');
            return;
          }
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if (!isInitializeRequest(body)) {
          writeJsonError(res, 400, -32000, 'Bad Request: expected initialize request or valid mcp-session-id');
          return;
        }

        const mcpServer = createServerInstance();
        let transport: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server: mcpServer, transport });
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) sessions.delete(id);
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId) {
          writeJsonError(res, 400, -32000, 'Bad Request: mcp-session-id header is required');
          return;
        }
        const existing = sessions.get(sessionId);
        if (!existing) {
          writeJsonError(res, 404, -32001, 'Unknown MCP session');
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    } catch (error) {
      writeJsonError(res, 500, -32603, error instanceof Error ? error.message : 'Internal server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 15174, host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : (options.port ?? 15174);

  return {
    server: httpServer,
    port: actualPort,
    url: `http://${host}:${actualPort}${mcpPath}`,
    close: async () => {
      for (const session of Array.from(sessions.values())) {
        await session.transport.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
