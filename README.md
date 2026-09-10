# Lazulite Studio

面向本地音乐的歌词制作工作台：承接 Lazulite 自动化证据，通过人工编辑产出 TTML，并逐步支持自包含 MP4/M4A 发布。

当前状态（2026-09-10）：**S1、S2、S3 已验收。** 支持真实登录、音频上传与持久项目、Range 播放、窗口波形、seek、倍速和 A/B 循环。`/editor` 保留本地 TTML 编辑、撤销重做与检查点恢复。项目富文档保存及完整歌曲制作闭环进入 S4。结果见 [S1](docs/s1-acceptance.md)、[S2](docs/s2-acceptance.md) 和 [S3 验收](docs/s3-acceptance.md)。

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
