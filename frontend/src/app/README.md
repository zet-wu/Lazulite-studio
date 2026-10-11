# App：应用生命周期

`App.tsx` 组合 Query provider、错误边界、路由、会话检查、登录和服务能力页。

- `/projects`：项目列表、创建、音乐与工程包导入。
- `/projects/:projectId/edit`：项目工作区。
- `/login`、`/settings`：登录及服务能力查看。
- `/editor`：重定向项目列表。

Workspace 负责编辑副本、服务保存、恢复和媒体生命周期，各模式共享容器内草稿、历史与播放状态。音乐首次接入后刷新项目资源。入口 `main.tsx` 在开发环境且 `VITE_ENABLE_MOCKS=true` 时加载 MSW。

app 可依赖 features、domain、adapters 和 shared；歌词规则由 domain 管理，格式与服务边界由 adapters 管理。
