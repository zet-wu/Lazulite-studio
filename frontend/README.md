# Frontend 架构

React／TypeScript／Vite SPA，通过 React Router 管理页面、TanStack Query 管理服务查询、TanStack Virtual 渲染变高列表。构建与运行入口见[项目 README](../README.md)，系统数据流见[项目架构](../docs/architecture.md)。

| 模块 | 职责 |
| --- | --- |
| [app](src/app/README.md) | 路由、会话、providers、错误边界 |
| [features](src/features/README.md) | 工作区与用户操作 |
| [domain](src/domain/README.md) | 项目状态、歌词及纯编辑命令 |
| [adapters](src/adapters/README.md) | 格式、HTTP、恢复 |
| [shared](src/shared/README.md) | 主题与通用界面 |

Workspace 持有项目连接、保存及资源，EditorWorkspace 组合获取、音频、编辑、打轴、预览、卡拉 OK 和打包。ProjectDocument 统一歌词、声学片段、编辑与输出配置，并管理 256 次撤销历史。媒体时钟、服务查询和 UI 偏好各自独立。

单一播放器负责原曲／人声试听，图形可独立选源；音频页通过 portal 展示同一时间轴。WAV／PCM／频谱使用音源实际采样率，窗口查询与 Worker 按资源身份管理生命周期。

项目列表通过归档接口读写 `.lazp`，按需查询空间分类。媒体任务捕获确切保存修订，当前页按任务意图接入人声或对齐结果。`src/mocks` 通过显式开发选项提供 MSW 服务。生产入口直接使用 HTTP API。

测试按职责分为单元／组件、模拟服务浏览器、真实服务集成和生产行为专项。`tests/manual` 保存显式运行的测量脚本，与常驻套件分离；在前端目录先执行 `pnpm build`，再执行 `pnpm measure:manual`，支持附加文件名筛选。测量结果写入 `performance-results/manual`。
