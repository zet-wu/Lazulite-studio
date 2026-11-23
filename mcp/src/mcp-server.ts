import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StudioClient } from './client';
import { registerAlignmentTools } from './tools/alignment';
import { registerLyricAcquisitionTools } from './tools/lyrics-acquisition';
import { registerMetadataAndSingerTools } from './tools/metadata-singers';
import { registerReadTools } from './tools/read';
import { registerReadingTools } from './tools/reading';
import { formatToolError, ToolRegistry } from './tools/registry';
import { installXmlDomShim } from './xml-shim';

export function createToolRegistry(): ToolRegistry {
  installXmlDomShim();
  const registry = new ToolRegistry();
  registerReadTools(registry);
  registerMetadataAndSingerTools(registry);
  registerLyricAcquisitionTools(registry);
  registerReadingTools(registry);
  registerAlignmentTools(registry);
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
          const result = await registry.execute(tool.name, args as Record<string, unknown>, { client });
          return {
            content: result && typeof result === 'object' && '__mcpContent' in result
              ? (result as import('./tools/registry').McpToolPayload).content
              : [{ type: 'text', text: JSON.stringify(result) }],
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
