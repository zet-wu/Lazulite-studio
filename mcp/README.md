# MCP 语义工具服务

`mcp/` 为外部 LLM / MCP Host 提供协议无关的语义工具层与 MCP Server，直接复用 `frontend/src/domain/` 与无浏览器依赖的 `frontend/src/adapters/`，通过 `/api/v1` 与 Lazulite Studio 后端通信。

## 模块划分

| 路径 | 职责 |
| --- | --- |
| `src/xml-shim.ts` | 在 Node 22 下挂载 `@xmldom/xmldom` 所需的 `DOMParser`、`XMLSerializer`、`Node`、`NodeFilter` 及最小 DOM 辅助方法 |
| `src/client.ts` | Studio HTTP 客户端：自动发现 `data/runtime/identity.json`（或使用 `STUDIO_URL`）、处理会话/CSRF 与 `If-Match` / `Idempotency-Key` |
| `src/tools/registry.ts` | 协议无关工具注册表与统一错误映射 |
| `src/tools/read.ts` | 只读工具：`list_projects`、`get_project_summary`、`get_source_metadata`、`get_lyrics` |
| `src/mcp-server.ts` | 将工具注册表接入 `@modelcontextprotocol/sdk` `McpServer` |
| `src/transports.ts` | `stdio` 与仅绑回环地址（`127.0.0.1`）的 Streamable HTTP 传输 |
| `src/index.ts` | CLI 入口与参数解析 |
| `scripts/build.mjs` | 使用 esbuild 生成单文件 ESM 产物 `dist/server.mjs` |

## 常用命令

```sh
pnpm --dir mcp typecheck
pnpm --dir mcp test
pnpm --dir mcp build
```
