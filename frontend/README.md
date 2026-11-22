# Frontend 架构

前端为 React 19 + TypeScript + Vite 单页应用，使用 React Router 管理路由、TanStack Query 管理服务端数据、TanStack Virtual 渲染变高歌词列表。安装与运行命令见 [开发与构建指南](../docs/development.md)，全局数据流见 [项目架构](../docs/architecture.md)。

## 模块划分

| 目录 | 职责 |
| --- | --- |
| [src/app](src/app/README.md) | 路由、登录会话、Provider、错误边界与顶栏 |
| [src/features](src/features/README.md) | 工作区与各功能模式交互（获取、音频、编辑、打轴、预览、卡拉 OK、打包） |
| [src/domain](src/domain/README.md) | 项目文档、歌词模型与纯编辑命令 |
| [src/adapters](src/adapters/README.md) | 格式编解码、HTTP 客户端与 IndexedDB 恢复 |
| [src/shared](src/shared/README.md) | 主题 token、图标与通用控件 |

## 核心状态分层

- **文档与撤销**：`Workspace` 持有项目连接、保存状态、本地恢复与媒体生命周期；`ProjectDocument` 统一管理歌词、编辑属性、声学片段、AMLL 选项与卡拉 OK 配置，维护 256 步撤销历史。
- **界面与偏好**：选区、展开状态与播放时钟由前端界面状态持有；主题、语言、快捷键、时间轴偏好、默认对齐参数等长期设置通过服务端 `/api/v1/settings` 持久化。
- **保存与恢复**：保存使用 `If-Match` 与幂等键，文档校验拒绝直接结束当前请求，网络异常等结果未知状态按原快照重试。本地草稿通过复用的 IndexedDB 连接防抖写入 `recovery-v11`（含源音频绑定身份），跨源恢复仅保留歌词并走冲突处理。

## 国际化（i18n）

界面语言基于 `i18next` / `react-i18next`，文案资源集中在 `src/i18n/resources/*.json`，语言清单由 `server/ui_languages.json` 与后端共享。领域层错误只传递语义键与参数，在渲染层实时翻译。维护命令见 [开发与构建指南](../docs/development.md#翻译与多语言维护)。

## 测试分层

- `tests/*.test.ts(x)` 与 `src/**/*.test.ts(x)`：Vitest 单元与组件测试。
- `tests/e2e/`：基于 MSW（`src/mocks`）的 Playwright 界面交互测试。
- `tests/integration/`：连接临时真实后端服务的端到端集成测试。
- `tests/performance/`：面向生产构建的长文档与媒体缓存性能测试。
