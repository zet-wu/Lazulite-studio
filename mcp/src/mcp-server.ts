import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StudioClient } from './client';
import { registerReadTools } from './tools/read';
import { formatToolError, ToolRegistry } from './tools/registry';
import { installXmlDomShim } from './xml-shim';

export function createToolRegistry(): ToolRegistry {
  installXmlDomShim();
  const registry = new ToolRegistry();
  registerReadTools(registry);
  return registry;
}

export function createMcpServer(client: StudioClient, registry: ToolRegistry = createToolRegistry()): McpServer {
  const server = new McpServer({
    name: 'lazulite-studio',
    version: '0.1.0',
  });

  for (const tool of registry.list()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          const result = await tool.execute(args as Record<string, unknown>, { client });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const formatted = formatToolError(error);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
          };
        }
      },
    );
  }

  return server;
}
