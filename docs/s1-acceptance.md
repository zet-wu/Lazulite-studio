# S1 开发验收记录

开发：2026-09-06 起；验收更新：2026-09-08。范围为 S1 工程、只读应用壳、模拟契约和 S2 前置 TTML 技术试验。

## 范围与边界

- React / TypeScript / Vite 单前端工程，React Router 管理深链接，TanStack Query 管理服务快照。
- OpenAPI 仅冻结本次只读模拟接口；富文档保存、上传、SSE 与发布接口仍遵循设计草案，尚未实现。
- 使用合成项目和歌词演示列表、工作区、任务和行属性；未接入真实项目存储、媒体播放和自动化任务。
- TTML 适配器是保真技术试验，不是完成 S2 的声明。命令历史、富模型完整编辑和恢复仍待实现。

## 前端设计

参考本机 `amll-ttml-tool` 的工具栏、歌词主视图、侧栏和底部音频操作区。Studio 使用独立实现的 CSS Modules 和设计变量：浅中性灰面板、蓝色选中与焦点、紧凑边框、等宽时间字段。未复制 AMLL 的源代码、字体或图形资源，也未引入 AMLL 预览依赖。

桌面工作区围绕选行查看属性组织三栏；窄屏切换面板。未接入的操作注明原因，合成任务结果不表示已有模型运行。只读状态不显示虚假的保存成功提示。

## 验证

已完成工程检查：Node 22.22.2、pnpm 10.30.3；安装锁文件已同步，OpenAPI 连续生成类型一致。直接依赖许可见 [依赖记录](dependency-licenses.md)。

主 Agent 最终复验结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，锁文件与 manifest 一致 |
| `pnpm contracts:generate` | 连续生成内容一致 |
| `pnpm typecheck` | 通过，包含源文件、配置与测试 |
| `pnpm test` | 3 个测试文件、14 项测试通过 |
| `pnpm build` | 通过；主 JS 274.55 kB，gzip 87.57 kB |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/lazulite-studio-browsers pnpm test:e2e` | Chromium 3 条流程全部通过 |
| 生产模式无后端检查 | 显示服务不可用；无模拟标识、无 Service Worker 注册、无页面异常 |

浏览器版本 Chromium 140.0.7339.16；主 Agent 亲自检查 1440×900 桌面和 390×844 窄屏。选行、空时间属性、面板切换无页面异常，窄屏 scrollWidth/scrollHeight 与视窗一致。截图：[项目列表](evidence/s1/projects.png)、[桌面工作区](evidence/s1/workspace-desktop.png)、[窄屏属性](evidence/s1/workspace-mobile.png)；[浏览器检查数据](evidence/s1/browser-review.json)。

浏览器测试覆盖项目搜索/打开/键盘选行、窄屏面板与选中行保留、空库/失败重试/会话过期恢复/加载状态、深链接、任务、能力设置和禁用导出。新建、保存、播放和最终导出未实现，按钮保持禁用。

结论：S1 退出条件通过。TTML probe 只证明当前只读 profile 的解析与保留树往返；尚未证明编辑写回、完整富模型和撤销恢复，因此 S2 仍未完成。

## 后续顺序

先完成 S2 的富模型、可逆事务、TTML profile 与历史恢复，再进入 S3 的项目/资产/修订持久化与媒体。S4 开放真实行编辑、人工应用提案和保存/导出闭环。当前不进行 GPU 质量、2,000 行性能或 MP4 发布验收。
