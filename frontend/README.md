# Frontend

采用 React + TypeScript + Vite、React Router、TanStack Query、CSS Modules。当前提供只读应用壳，数据由显式启用的 MSW 模拟接口提供；真实服务尚未实现。

| 目录 | 作用 |
| --- | --- |
| [src/app](src/app/README.md) | 组合根、路由、providers、页面壳 |
| [src/features](src/features/README.md) | 项目与歌词工作区功能 |
| [src/domain](src/domain/README.md) | 纯领域模型、事务、历史和规则 |
| [src/adapters](src/adapters/README.md) | HTTP、TTML、预览、媒体及存储边界 |
| [src/shared](src/shared/README.md) | 无业务依赖的 UI 与工具 |
| [tests](tests/README.md) | 跨模块与浏览器行为验收 |

依赖：app → features → domain；adapters → domain，由 app 注入实现。shared 不引用业务层。服务端缓存、编辑文档与播放时钟分开管理；避免以一个全局 store 混装所有状态。

## 本地运行

在 `frontend/` 目录运行，Node 版本见 [`../.node-version`](../.node-version)，pnpm 与直接依赖固定在 `package.json`，传递依赖固定在 `pnpm-lock.yaml`。

```sh
npx pnpm@10.30.3 install --frozen-lockfile
npx pnpm@10.30.3 dev:mock
```

打开终端输出的本地地址，默认路由为 `/projects`。直接工作区入口为 `/projects/sample-project/edit`。`?scenario=empty`、`?scenario=error`、`?scenario=expired`、`?scenario=loading` 分别用于空库、服务失败、会话过期和加载状态；移除参数恢复正常演示。

浏览器验收使用 `pnpm test:e2e`；若浏览器缓存需要放在临时目录，可先设置 `PLAYWRIGHT_BROWSERS_PATH=/tmp/lazulite-studio-browsers`。

`dev:mock` 显式开启合成数据。`dev` 默认请求同源 `/api/v1`，Vite 开发代理指向 `http://localhost:8000`；没有后端时会显示服务失败。生产构建不启用模拟，部署需要同源 API 和 SPA 路由回退。

```sh
npx pnpm@10.30.3 contracts:generate
npx pnpm@10.30.3 typecheck
npx pnpm@10.30.3 test
npx pnpm@10.30.3 build
```

浏览器测试（首次需要安装 Chromium）：

```sh
npx pnpm@10.30.3 exec playwright install chromium
npx pnpm@10.30.3 test:e2e
```

测试自动在 `127.0.0.1:5174` 启动独立模拟服务，不需要手动启动。若将浏览器安装在自定义目录，安装和测试时都设置相同的 `PLAYWRIGHT_BROWSERS_PATH`。本次沙箱验收使用 `/tmp/lazulite-studio-browsers`。

实际结果见 [验收记录](../docs/s1-acceptance.md)。设计基线见 [架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)。
