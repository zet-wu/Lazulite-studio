# Lazulite Studio

面向本地音乐的歌词制作工作台：承接 Lazulite 自动化证据，通过人工编辑产出 TTML，并逐步支持自包含 MP4/M4A 发布。

当前状态（2026-09-25 文档核对）：S1–S6 功能已实现，S7 Studio 发布链路已完成。支持把已保存歌词封装到 MP4/M4A 的单样本 STPP 轨道，回读校验后下载独立成品；MusicBox 当前版本尚不能直接提取该轨道，完整消费端退出条件尚未满足。见 [S7 验收](docs/s7-acceptance.md)与[消费端检查](docs/s7-musicbox-compatibility.md)。细粒度编辑及模型、性能边界见 [S6](docs/s6-acceptance.md)，历史记录见 [S1](docs/s1-acceptance.md)、[S2](docs/s2-acceptance.md)、[S3](docs/s3-acceptance.md)、[S4](docs/s4-acceptance.md)、[S5](docs/s5-acceptance.md)。

## 设计入口

当前歌词编辑器已实施 E0–E7：词块/Ruby、分词、连续打轴、时间轴、频谱/BPM、AMLL 预览和多格式文件菜单。执行入口为[歌词编辑器实施计划](docs/lyric-editor-implementation-plan.md)，逐项进展和未完成的外部验证见[对齐清单](docs/editor-parity.md)与[E7 验收](docs/editor-e7-acceptance.md)，开发约定见 [AGENTS.md](AGENTS.md)。

- [前端架构](../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)：技术选择、工作区、富歌词模型、状态与 TTML 保真。
- [服务契约草案](../lyric-workflow/docs/lazulite_studio_service_contract.md)：项目、媒体、保存版本、任务与 SSE。
- [实施计划](../lyric-workflow/docs/lazulite_studio_implementation_plan.md)：阶段、下一轮工作包和验收要求。
- [总体音乐工作流](../lyric-workflow/docs/lazulite_music_workflow_plan.md)：Lazulite、Studio 和 MusicBox 的职责。

下一阶段的详细编辑器规划维护在本仓库 `docs/`；并列 `lyric-workflow/docs` 维护总体工作流、当前架构和服务衔接摘要，不复制新计划全文。跨仓库链接需要保持并列目录布局。

## 仓库结构

| 目录 | 职责 |
| --- | --- |
| [frontend](frontend/README.md) | React/TypeScript/Vite SPA |
| [contracts](contracts/README.md) | 前后端协议与后续生成类型的来源 |
| [server](server/README.md) | FastAPI 会话、项目、修订存储与媒体服务 |
| [docs](docs/README.md) | 架构约束和设计索引 |

TTML 承载歌词权威内容，项目数据库承载工作流，浏览器持有未保存工作副本。Lazulite 的行级模型只用于自动化；AMLL 只读取当前歌词草稿用于动态预览，不改写权威文档。默认部署方向为 GPU 主机提供静态前端和同源 API，浏览器无需安装模型。

启动与验证命令见 [前端说明](frontend/README.md) 和 [服务端说明](server/README.md)。模拟模式只使用合成数据，不连接 Lazulite 引擎；默认启动模式请求同源 API。
