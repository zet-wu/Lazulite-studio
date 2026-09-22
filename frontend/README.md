# Frontend

采用 React + TypeScript + Vite、React Router、TanStack Query、CSS Modules。S3 接入真实项目服务、上传与媒体播放；显式启用的 MSW 保留 S1 模拟场景。`/editor` 继续提供独立的本地 TTML 编辑入口。

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

本地文件入口为 `/editor`，可在 `dev` 模式下使用，不需要 API 会话。普通文本行支持正文和起止秒数编辑，空时间表示未定；点击“应用修改”形成一次撤销事务。服务项目工作台在 S5 开放可理解的整体 Ruby，复杂混合结构和未知语义仍按字段只读；独立 `/editor` 保留原有基础编辑范围。

本地检查点与服务器修订分开：S2 实施范围及当前检查进度见 [实施记录](../docs/s2-implementation.md)。草稿使用 Studio 命名空间标记未定时间，最终 TTML 需通过完整时间与 profile 检查。

浏览器验收使用 `pnpm test:e2e`；若浏览器缓存需要放在临时目录，可先设置 `PLAYWRIGHT_BROWSERS_PATH=/tmp/lazulite-studio-browsers`。

`dev:mock` 显式开启合成数据。`dev` 默认请求同源 `/api/v1`，Vite 开发代理指向 `http://localhost:8000`；没有后端时会显示服务失败。生产构建不启用模拟，部署需要同源 API 和 SPA 路由回退。

真实工作台先按 [服务端说明](../server/README.md) 启动 API，再运行 `npm run dev`。设置 `STUDIO_ORIGIN` 与浏览器地址一致，输入服务端密码登录。上传并创建项目后，底部提供播放、速度、波形定位、A/B 循环和窗口缩放；有完整时间的选中行可循环试听。波形支持方向键及 Home/End，工作区空格切换播放；输入控件和 IME 保留自身按键行为。

服务项目与本地 `/editor` 是独立入口。项目工作台支持自动保存、任务候选、行复核和多歌手；右侧“注音”用正文选择建立整体 reading，左侧“词典”维护项目特有读音，自动读音仍需人工应用并在保存后确认。

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

实际结果见 [S1](../docs/s1-acceptance.md)、[S2](../docs/s2-acceptance.md)、[S3](../docs/s3-acceptance.md)、[S4](../docs/s4-acceptance.md)、[S5](../docs/s5-acceptance.md) 验收记录。设计基线见 [架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)。

## S6 时间精修

右侧“时间”选择正文或某段读音，选择范围后建立词/音拍/音素单元；使用单元内光标拆分、合并相邻单元，或编辑秒数、拖动边界。空时间表示未定，最终导出前必须补齐。底部可循环当前单元。行属性正文内的光标用于拆行，“整体前移/后移”同时移动行及其单元；直接修改行起止只调整边界，不移动已有单元。

左侧“歌手”可创建组合、选择成员，再将组合分配给行。实验精细对齐需要服务端配置独立 forced 后端：先保存并确认正文/读音，再创建任务，查看结果后人工应用。任务结果继续受 revision/asset 与 dirty 状态约束。范围和已知边界见 [S6 验收](../docs/s6-acceptance.md)。
