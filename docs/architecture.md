# Lazulite Studio 项目架构

2026-09-27 更新：Phase 2 R1 已将语义模型切至 v5，R2–R7 交互整改仍按[外部开发计划](../../lyric-workflow/docs/studio/plans/phase2-human-review-remediation.md)实施。

## 1. 应用与目录

React 19 / TypeScript / Vite SPA，React Router 负责路由，TanStack Query 管理服务缓存，CSS Modules 管布局，TanStack Virtual 渲染变高列表。AMLL 0.5.2 按需预览；`hyphen` 与 `wanakana` 用于音节/假名处理。具体版本由 `frontend/package.json` 和锁文件固定。

| 位置 | 职责 |
| --- | --- |
| `frontend/src/app` | 路由、会话、Query provider、错误边界 |
| `frontend/src/features/editor` | 共用画布、行/词/Ruby、分词/批处理/音译、打轴、预览、菜单 |
| `frontend/src/features/Workspace.tsx` | 项目连接、保存、候选、词典/复核和媒体组合 |
| `frontend/src/features/MediaTransport.tsx`、`TimelineTracks.tsx` | 主媒体时钟、波形/PCM 声谱图、循环和时间轴 |
| `frontend/src/domain` | 语义文档、命令/历史、文本边界、分词、时间、预览投影 |
| `frontend/src/adapters` | HTTP、TTML、其他歌词格式、IndexedDB |
| `contracts` | OpenAPI 及生成类型来源，存在已知覆盖缺口 |
| `server` | FastAPI、SQLite、资产/修订文件、任务、读音和发布 |
| `tests/fixtures/ttml` | 前后端测试共用合成 TTML 输入；不依赖外部文档仓库 |

## 2. 路由与组合

`/editor` 由 LocalEditor 管本地文件与检查点，`/projects/:projectId/edit` 由 Workspace 管项目；两者使用同一个 EditorWorkspace、领域命令和 codec。项目路由有音频服务与保存冲突处理；本地路由没有同等媒体资产能力。

其他路由为 `/projects`、`/projects/:projectId/export`、`/login`、`/settings`。编辑器当前提供编辑/打轴/预览，项目辅助仍在属性区域；整改计划将移成一级占位页。

## 3. 权威文档与事务

`LyricDocument`（`studio-lyric-v5`）为唯一可写歌词文档，含 lines、romanizationTracks、agents、metadata、language。行包含 words、背景父 ID、agentRefs、翻译与时间链接；词含 text、时间、Ruby 单元、对齐单元、空拍等。音译轨道按主行 ID 引用，保存语言、顺序、plain/timed 内容及定时单元。正文由词拼接，读音由 Ruby 拼接。

时间使用绝对整数微秒/null；拆分坐标使用 code point 并检查 grapheme 边界。`lyric-commands.ts` 提供纯函数事务与 256 次历史。selection、focus、播放时钟不作为歌词权威内容；批量操作一次入历史，最终改动经 codec 保存。

词级与行级旧音译字段已移除，预览临时派生逐词音译与二侧歌手状态。R2 将补全轨道附属行的可编辑视图。

## 4. 格式与保存

`adapters/ttml/lyric-codec.ts` 解析为语义文档并规范化导出，旧 XML 保留树模型已移除。支持常见词/Ruby/背景、行内和 iTunes sidecar 附属内容、当前草稿辅助属性，以及 AMLL 无命名空间子节点和绝对分钟时间修复；未知不支持内容会报错，不宣称任意 TTML 可无损编辑。

`lyric-formats.ts` 支持文本、LRC/ESLRC/QRC/YRC/LYS 双向与 ASS 导出。低表达力格式不能携带全部 Ruby/元数据或多条音译轨道。预览投影只使用完整时间，不修改文档；isDuet 从歌手引用派生。

项目由 `useProjectDocument` 持有本地副本、dirty、revision/ETag、保存序号和冲突。IndexedDB 保存当前格式检查点；FastAPI 接受 TTML envelope，不接收浏览器对象图。修订以不可变文件与 DB 指针提交。候选只能由用户应用。

## 5. 媒体与服务

HTMLMediaElement 为项目主时钟，媒体代理 offset 在边界转换；服务提供音频 Range、窗口 peaks 和 PCM。声谱图 Worker 按需计算，BPM 提供手动/Tap/自动估计。当前循环仍分 off/ab/line/unit，待整改统一。

服务为登录用户共享项目库的单工作台，显式配置会话/网关模式。任务状态持久化，SSE 提供变化，结果从资源接口读取。reading、词典与实验 forced 的可用性取决于配置；HTTP 通过不代表模型质量。

发布读取已保存修订，为受支持非分片 MP4/M4A 添加单 sample STPP 并回读校验后下载。MusicBox 消费端的已知限制仍在；本次不改发布实现。

## 6. 文档与依赖边界

领域不依赖 HTTP/DOM；适配器处理格式和服务，功能组件组合交互。模型变化时直接更新当前实现，不建立旧 schema 双写/回退。必要输入校验、撤销和保存一致性仍保留。

本仓库保留本文、模块结构说明与 AGENTS.md。方案、运行手册、过程及验收在 [lyric-workflow/docs/studio](../../lyric-workflow/docs/studio/README.md)，两者冲突时更新实际架构说明，不能把未来方案混成已实现状态。
