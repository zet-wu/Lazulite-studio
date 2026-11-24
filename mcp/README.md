# MCP 语义工具服务

`mcp/` 为外部 LLM / MCP Host 提供协议无关的语义工具层与 MCP Server，直接复用 `frontend/src/domain/` 与无浏览器依赖的 `frontend/src/adapters/`，通过 `/api/v1` 与 Lazulite Studio 后端通信。

当前注册 36 个工具，覆盖项目与歌词读取、结构／时间／附属歌词编辑、注音与音译生成、批处理、人声／对齐任务、声学及音频听审。计算类工具默认 `dry_run=true`，显式应用时使用同套领域命令与项目 CAS。`get_lyrics` 支持分级 JSON 与双文本块 TTML；切片摘要携带依赖上下文及项目侧信息。`get_audio_excerpt` 返回元数据文本和 MCP audio 块，时窗最多 30 秒。

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
| `src/tools/editing.ts`、`src/tools/timing.ts` | 正文与行结构局部编辑、时间端点／空拍与行尾联动；批内新对象引用 |
| `src/tools/sublyrics.ts` | 翻译／音译的轨道、内容和计时单元读取与编辑 |
| `src/tools/transforms.ts` | 无状态预演／应用分词、音译生成、反向注音与批处理 |
| `src/tools/audio-jobs.ts` | 独立人声任务、历史／CPU 重试／结果确认、声学能量与有界音频听审 |
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

`preview_alignment` 与 `start_alignment` 接受相同的 `scope_ids` 以对齐选中的读音单元。启动参数的 `audio_source`（`vocals`／`original`）和 `crop_vocals` 分别控制波形来源与人声片段裁切；原曲关闭裁切时直接使用源音频。结果中的 `selection` 由共享领域合并逻辑约束更新范围。
