# Lazulite Studio

面向本地音乐的歌词制作工作台：承接 Lazulite 自动化证据，通过人工编辑产出 TTML，并逐步支持自包含 MP4/M4A 发布。

当前状态（2026-09-12）：S1–S5 已验收。除项目、媒体与行级制作闭环外，现已支持整体词级 Ruby 编辑、SudachiPy 读音候选、人工确认和项目读音词典；词典只参与之后生成的候选。验证结果与边界见 [S5 验收](docs/s5-acceptance.md)，历史记录见 [S1](docs/s1-acceptance.md)、[S2](docs/s2-acceptance.md)、[S3](docs/s3-acceptance.md)、[S4](docs/s4-acceptance.md)。

## 设计入口

- [前端架构](../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)：技术选择、工作区、富歌词模型、状态与 TTML 保真。
- [服务契约草案](../lyric-workflow/docs/lazulite_studio_service_contract.md)：项目、媒体、保存版本、任务与 SSE。
- [实施计划](../lyric-workflow/docs/lazulite_studio_implementation_plan.md)：阶段、下一轮工作包和验收要求。
- [总体音乐工作流](../lyric-workflow/docs/lazulite_music_workflow_plan.md)：Lazulite、Studio 和 MusicBox 的职责。

详细规划暂放在并列的 `lyric-workflow` 仓库；本仓库目录说明可独立阅读。设计冻结后迁入本仓库，迁移前跨仓库链接需要保持并列目录布局。

## 仓库骨架

| 目录 | 职责 |
| --- | --- |
| [frontend](frontend/README.md) | React/TypeScript/Vite SPA |
| [contracts](contracts/README.md) | 前后端协议与后续生成类型的来源 |
| [server](server/README.md) | FastAPI 会话、项目、修订存储与媒体服务 |
| [docs](docs/README.md) | 架构约束和设计索引 |

TTML 承载歌词权威内容，项目数据库承载工作流，浏览器持有未保存工作副本。Lazulite 的行级模型只用于自动化；AMLL 只作为单向预览适配目标。默认部署方向为 GPU 主机提供静态前端和同源 API，浏览器无需安装模型。

启动与验证命令见 [前端说明](frontend/README.md) 和 [服务端说明](server/README.md)。模拟模式只使用合成数据，不连接 Lazulite 引擎；默认启动模式请求同源 API。
