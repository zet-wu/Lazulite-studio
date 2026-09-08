# Lazulite Studio

面向本地音乐的歌词制作工作台：承接 Lazulite 自动化证据，通过人工编辑产出 TTML，并逐步支持自包含 MP4/M4A 发布。

当前状态（2026-09-09）：**S1 应用壳与 S2 本地 TTML 编辑基础已验收。** `/editor` 支持文件导入、普通行文字和时间修改、撤销重做、草稿下载与本地检查点恢复。结果见 [S1 验收](docs/s1-acceptance.md) 和 [S2 验收](docs/s2-acceptance.md)。真实服务、媒体和完整歌曲制作闭环属于后续阶段。

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
| [server](server/README.md) | 同机 Studio API 与任务执行服务的边界预留 |
| [docs](docs/README.md) | 架构约束和设计索引 |

TTML 承载歌词权威内容，项目数据库承载工作流，浏览器持有未保存工作副本。Lazulite 的行级模型只用于自动化；AMLL 只作为单向预览适配目标。默认部署方向为 GPU 主机提供静态前端和同源 API，浏览器无需安装模型。

启动与验证命令见 [前端说明](frontend/README.md)。模拟模式只使用合成数据，不连接 Lazulite 引擎；默认启动模式请求同源 API。
