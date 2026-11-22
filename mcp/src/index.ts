import { parseArgs } from 'node:util';
import { StudioClient } from './client';
import { createMcpServer, createToolRegistry } from './mcp-server';
import { runStdioServer, startHttpMcpServer } from './transports';

function readCliArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      transport: { type: 'string', default: 'stdio' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '15174' },
      path: { type: 'string', default: '/mcp' },
      'studio-url': { type: 'string' },
      'identity-file': { type: 'string' },
      'data-dir': { type: 'string' },
    },
    strict: true,
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${values.port}`);
  }
  return {
    transport: values.transport,
    host: values.host,
    port,
    path: values.path,
    studioUrl: values['studio-url'],
    identityFile: values['identity-file'],
    dataDir: values['data-dir'],
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const client = new StudioClient({
    baseUrl: args.studioUrl,
    identityFile: args.identityFile,
    dataDir: args.dataDir,
  });
  const registry = createToolRegistry();
  const factory = () => createMcpServer(client, registry);

  if (args.transport === 'stdio') {
    await runStdioServer(factory);
    return;
  }

  if (args.transport === 'http') {
    const handle = await startHttpMcpServer(factory, {
      host: args.host,
      port: args.port,
      path: args.path,
    });
    console.error(`Lazulite Studio MCP listening on ${handle.url}`);
    const shutdown = () => {
      void handle.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  throw new Error(`Unsupported transport: ${args.transport}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
