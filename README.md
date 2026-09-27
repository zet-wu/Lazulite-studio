# Lazulite Studio

面向本地音乐的歌词制作工作台。浏览器负责歌词编辑和试听；FastAPI 管理项目、媒体、不可变 TTML 修订、自动化候选及 MP4/M4A 发布。AMLL 只读取当前草稿作预览，不回写权威文档。

## 架构入口

- [项目架构](docs/architecture.md)：当前语义文档、编辑事务、播放、服务与路由。
- [前端结构](frontend/README.md)、[服务端结构](server/README.md)、[契约边界](contracts/README.md)。
- [开发约定](AGENTS.md)。

歌词编辑器已包含词块/Ruby、分词、打轴、时间轴和预览。当前仍有音译多路径、agent/duet 重复状态及桌面交互问题；统一音译轨道等整改尚未实现。架构说明按实际源码描述，不把计划写成当前能力。

## 外部开发文档

开发方案、审阅、过程记录、验收及证据统一保存在并列的 [lyric-workflow](../lyric-workflow/docs/studio/README.md)：[当前状态](../lyric-workflow/docs/studio/current-state.md)、[Phase 2 方案](../lyric-workflow/docs/studio/plans/phase2-human-review-remediation.md)、[前端运行](../lyric-workflow/docs/studio/development/frontend-development.md)、[服务端运行](../lyric-workflow/docs/studio/development/server-development.md)、[依赖许可](../lyric-workflow/docs/studio/reference/dependency-licenses.md)。本仓库不再保存开发过程文档；可执行测试夹具仍随源码维护。
