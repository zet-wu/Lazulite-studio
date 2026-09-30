# App：组合与应用生命周期

当前 `App.tsx` 负责 Query provider、错误边界、浏览器路由、会话检查、登录和服务能力页。

- `/editor`：无需 API 会话的本地歌词文件编辑入口。
- `/projects`：项目列表和创建/上传入口。
- `/projects/:projectId/edit`：项目工作区，编辑副本和媒体生命周期由功能组件管理。
- `/login`、`/settings`：登录与服务能力查看。

模拟数据仅在显式开启 `VITE_ENABLE_MOCKS` 的开发环境使用。本地和项目路由已共用 `EditorWorkspace`、命令和 TTML codec；LocalEditor 与 Workspace 分别承担文件检查点和项目服务/媒体连接。

可依赖 features、domain、adapters、shared；歌词规则和 XML 解析留在对应模块。

歌词获取和文件打包为共用工作区模式；切换保持容器内草稿、历史和媒体状态。独立 export 路由已删除。
