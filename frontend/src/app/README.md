# App：应用生命周期

`App.tsx` 负责组合 Query Provider、错误边界、路由、登录会话检查与常驻顶栏。应用在加载完资料库偏好后初始化语言与主题；项目页通过 `ApplicationHeaderContext` 将编辑菜单挂入顶栏，项目列表和加载页仅显示全局入口。

## 页面路由

- `/projects`：项目列表、新建项目、音频与 `.lazp` 工程导入。
- `/projects/:projectId/edit`：项目编辑工作区。
- `/login`、`/settings`：登录页与服务状态/设置页。
- `/editor`：重定向至 `/projects`。

开发环境下设置 `VITE_ENABLE_MOCKS=true` 时，`main.tsx` 会启动 MSW 模拟 API 方便纯前端调试。依赖方向上，`app` 可调用 `features`、`domain`、`adapters` 与 `shared`。
