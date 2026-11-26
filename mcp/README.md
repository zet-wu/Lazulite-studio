# MCP 语义工具服务

`mcp/` 为外部大语言模型与支持 MCP（Model Context Protocol）的客户端提供语义工具层与 MCP Server，直接复用 `frontend/src/domain/` 与无浏览器依赖的 `frontend/src/adapters/`，通过 `/api/v1` 与 Lazulite Studio 后端通信。

当前共注册 41 个工具、2 个工作流 Prompt（`full_lyric_workflow`、`refine_alignment_anomalies`）与 1 份参数说明资源（`lazulite://guides/alignment-and-segmentation`），覆盖项目与歌词读取、结构／时间／附属轨道编辑、分词与自动注音、人声分离、全局与局部自动对齐、异常行筛查、局部声谱图生成及音频切片听审。所有写入与结果应用均复用前端领域命令并通过 `If-Match` 乐观锁（CAS）提交保存，浏览器工作台可通过 SSE 实时同步并支持一步撤销。

## 模块划分

| 路径 | 职责 |
| --- | --- |
| `src/xml-shim.ts` | 在 Node 22 下挂载 `@xmldom/xmldom` 所需的 `DOMParser`、`XMLSerializer`、`Node`、`NodeFilter` 及基础 DOM 辅助方法 |
| `src/client.ts` | Studio HTTP 客户端：自动发现 `data/runtime/identity.json`（或读取 `STUDIO_URL`），处理会话/CSRF、`If-Match` 与 `Idempotency-Key` |
| `src/tools/registry.ts` | 协议无关的工具注册表与统一错误映射 |
| `src/tools/cas.ts` | 乐观锁写入封装（读取最新修订 → 执行领域事务 → 序列化校验 → `If-Match` 保存） |
| `src/tools/read.ts` | 只读查询：`list_projects`、`get_project_summary`、`get_source_metadata`、`get_lyrics`（支持分级 JSON 与分页 TTML） |
| `src/tools/metadata-singers.ts` | 元数据与歌手管理：`update_metadata`、`manage_singers` |
| `src/tools/lyrics-acquisition.ts` | 歌词检索与导入：`search_online_lyrics`、`fetch_online_lyrics`、`get_embedded_lyrics`、`import_lyrics` |
| `src/tools/reading.ts` | 自动注音分析与写入：`analyze_japanese_reading`、`list_dictionaries`、`analyze_dictionary_reading`、`apply_readings` |
| `src/tools/editing.ts`、`src/tools/timing.ts` | 正文与行结构编辑、时间端点与空拍/终止点编辑（支持同批次内通过 `client_ref` 引用新建对象） |
| `src/tools/sublyrics.ts` | 翻译与音译轨道、行内容及逐词计时单元的读取与编辑 |
| `src/tools/transforms.ts` | 分词、罗马字音译生成、从音译反推注音与批处理（默认 `dry_run=true` 先返回预览，确认后落盘） |
| `src/tools/audio-jobs.ts` | 人声分离启动与模型选择（`demucs` / `bs-karaoke`）、任务查询/取消/CPU 重试、声学片段编辑与选用、能量查询及最多 30 秒的音频切片听审（`get_audio_excerpt`） |
| `src/tools/alignment.ts` | 对齐模型查询、全局/局部对齐预览与启动（`preview_alignment`、`start_alignment`）、结果应用及异常行筛查（`inspect_alignment_anomalies`） |
| `src/timeline-visual.ts` | 局部时间轴与声谱可视化（`get_timeline_visual`）：复用领域 FFT 生成最多 15 秒窗口的 80–8000 Hz 对数声谱、人声片段、编号读音条与空隙 PNG 图像及 JSON 映射 |
| `src/tools/karaoke.ts` | 导唱符读取、合法空隙查询与增删改 |
| `src/guidance.ts` | 内置工作流指引（instructions）、Prompt 模板与对齐/分词参数说明 Resource |
| `src/mcp-server.ts`、`src/transports.ts`、`src/index.ts` | 接入 `@modelcontextprotocol/sdk`，提供 `stdio` 与仅监听回环地址（`127.0.0.1`）的 Streamable HTTP 传输 |
| `scripts/build.mjs` | 使用 esbuild 打包生成单文件 ESM 产物 `dist/server.mjs` |

## 常用命令

```sh
pnpm --dir mcp typecheck
pnpm --dir mcp test
pnpm --dir mcp build
```

## 连接方式

- **本地打包版默认 Streamable HTTP**：`portable.py` 启动时会自动拉起内置 Node 22 与 `app/mcp/server.mjs`，在同端口回环地址暴露 `http://127.0.0.1:15173/mcp`（校验回环 Host/Origin）。
- **独立 `stdio` 模式**：

```sh
node mcp/dist/server.mjs --transport stdio --data-dir path/to/data
```

## 核心工具工作流说明

- **全局与局部自动对齐**：`preview_alignment` 与 `start_alignment` 除了全曲对齐外，还支持传入互斥的 `scope_line_ids`、`scope_word_ids` 或 `scope_ids` 执行局部对齐，并可分别指定 `audio_source`（`vocals` / `original`）与 `crop_vocals`。局部对齐会截取所选目标的最小起点到最大终点作为连续音频窗口；因此重算不相邻的多处异常行时，应按单行或连续相邻行拆分为独立任务逐个预览、运行并应用。
- **异常筛查与声谱/听审复核**：`inspect_alignment_anomalies` 用于快速筛查极短音节、同行同元音时长失衡或缺失时间轴的候选行；筛出候选后，可配合 `get_timeline_visual` 查看该行对应的局部声谱与编号读音条（检查长拖音尾音提前结束、间奏边界吸引或相邻词滑移），或调用 `get_audio_excerpt` 获取对应时间窗的音频切片复核，再决定直接调用 `edit_timing` 微调端点还是换用另一对齐模型（如用 `MMS_FA + 智能延长` 修补 `NextFire` 的局部挤缩）重算。
- **批处理闭合短空隙**：`batch_edit_lyrics` 的 `smooth` 操作会沿着同一行内的连续读音单元（有注音的词按各个注音、无注音的词按正文词）消除短于阈值的微小空隙或轻微重叠，并自动同步父词与父行的时间包络；`include_non_cjk` 默认关闭，开启后可一并处理拉丁字母等非中日韩读音（纯空白与标点始终跳过）。
