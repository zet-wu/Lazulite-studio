# Lazulite Studio

面向本地音乐的歌词制作工作台。浏览器负责歌词编辑和试听；FastAPI 管理项目、媒体、不可变 TTML 修订、自动化候选及 MP4/M4A、MP3、FLAC 歌词打包。AMLL 只读取当前草稿作预览，不回写权威文档。

工作区依次提供歌词获取、编辑、打轴、预览、文件打包与项目辅助。四源载荷保留原始歌词粒度，预览和元数据整组选择后一次导入；打包绑定已保存快照，并验证歌词、非目标内容和音频载荷。统一开发入口为根目录 `dev.py`，具体环境准备见运行手册。

## 架构入口

- [项目架构](docs/architecture.md)：当前语义文档、编辑事务、播放、服务与路由。
- [前端结构](frontend/README.md)、[服务端结构](server/README.md)、[契约边界](contracts/README.md)。
- [开发约定](AGENTS.md)。

歌词编辑器已包含词块/Ruby、分词、打轴、时间轴和预览。Phase 2 已统一 v5 音译轨道、移除重复 duet，接入背景父关系、附属行、显式生成 Ruby、桌面菜单和单一 A/B。Phase 3 已实现共享时间坐标、独立重叠子轨、侧栏调宽显隐、长短列表定位和统一菜单。Phase 4 已修正收起高度与播放高亮，按10ms边缘匹配生成Ruby提案、默认跳过相同假名并保留人工选择；窄块使用既有缩放编辑，背景保留独立时间与实际AMLL展示。大提案仅挂载可见行。架构说明按实际源码描述，不把计划写成当前能力。

## 外部开发文档

开发方案、审阅、过程记录、验收及证据统一保存在并列的 [lyric-workflow](../lyric-workflow/docs/studio/README.md)：[当前状态](../lyric-workflow/docs/studio/current-state.md)、[当前获取与打包方案](../lyric-workflow/docs/studio-search-release-review/Review-phase0/plan.md)、[前端运行](../lyric-workflow/docs/studio/development/frontend-development.md)、[服务端运行](../lyric-workflow/docs/studio/development/server-development.md)、[依赖许可](../lyric-workflow/docs/studio/reference/dependency-licenses.md)。本仓库不再保存开发过程文档；可执行测试夹具仍随源码维护。
