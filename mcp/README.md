# MCP 语义工具服务

`mcp/` 为外部 LLM / MCP Host 提供协议无关的语义工具层与 MCP Server，直接复用 `frontend/src/domain/` 与无浏览器依赖的 `frontend/src/adapters/`，通过 `/api/v1` 与 Lazulite Studio 后端通信。

## 模块划分

| 路径 | 职责 |
| --- | --- |
| `src/xml-shim.ts` | 在 Node 22 下挂载 `@xmldom/xmldom` 所需的 `DOMParser`、`XMLSerializer`、`Node`、`NodeFilter` 及最小 DOM 辅助方法 |
| `src/client.ts` | Studio HTTP 客户端：自动发现 `data/runtime/identity.json`（或使用 `STUDIO_URL`）、处理会话/CSRF 与 `If-Match` / `Idempotency-Key` |
| `src/tools/registry.ts` | 协议无关工具注册表与统一错误映射 |
| `src/tools/cas.ts` | 通用乐观锁 CAS 写入封装（读取最新修订 → 领域事务变换 → `serializeProject` → `If-Match` + `Idempotency-Key` 保存） |
| `src/tools/read.ts` | 只读工具：`list_projects`、`get_project_summary`、`get_source_metadata`、`get_lyrics` |
| `src/tools/metadata-singers.ts` | 元数据与歌手工具：`update_metadata`、`manage_singers` |
| `src/tools/lyrics-acquisition.ts` | 歌词检索与导入：`search_online_lyrics`、`fetch_online_lyrics`、`get_embedded_lyrics`、`import_lyrics` |
| `src/tools/reading.ts` | 注音分析与写入：`analyze_japanese_reading`、`list_dictionaries`、`analyze_dictionary_reading`、`apply_readings` |
| `src/tools/alignment.ts` | 自动对齐编排：`list_alignment_models`、`preview_alignment`、`start_alignment`、`get_job_status`、`cancel_job`、`apply_alignment_result` |
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

## 连接方式

- **便携包默认 Streamable HTTP**：`portable.py` 启动时拉起内置 Node 22 与 `app/mcp/server.mjs`，并在回环地址同端口暴露 `http://127.0.0.1:15173/mcp`（仅接受回环 Host/Origin）。
- **独立 `stdio` 模式**：

```sh
node mcp/dist/server.mjs --transport stdio --data-dir path/to/data
```
