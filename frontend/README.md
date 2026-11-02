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

保存请求保留 HTTP 状态、业务错误及请求标识。明确的文档校验拒绝结束本次 pending 请求，修正内容使用新操作身份保存；响应丢失等结果未知情况使用原快照和操作身份重试，确认后再保存后续编辑。

项目中的手工时间和声学片段以非负安全整数及既定内部关系校验。图形拖动在吸附和联动后检查实际改变的端点，以源音频时长为上限。文件校验按源身份与时长生成非阻塞音频范围警告；新的人声片段按源范围求交并报告裁切／丢弃数量。

设置中的音频导入与空状态共用上传／保存／切换流程。切换后媒体组件按源身份重新挂载，歌词编辑器保留状态，历史中的声学数据清空。恢复记录为 recovery-v11／record 11，保存源资产身份；跨源恢复只保留歌词并沿用修订冲突处理。旧恢复库不读取或转换。其他页面通过资料库范围通知刷新源身份，有未保存歌词时保留内容并提示冲突。

界面语言使用 i18next／react-i18next 和本地 JSON 资源。`src/i18n` 管理语言匹配、订阅和格式化；`server/ui_languages.json` 是前后端共用的语言注册表。资料库偏好 `studio:ui-language` 以 revision 更新。领域层的 Message 只保存语义键和参数；Notice 与持续错误在渲染时翻译，语言更新不重新发布事件。

翻译资源以 `src/i18n/resources/*.json` 为唯一译文来源，`context.json` 记录用途、源文及参数。运行 `pnpm i18n:check` 校验资源；`pnpm i18n:export /tmp/translations.csv` 导出 UTF-8 对照表，编辑后使用 `pnpm i18n:import /tmp/translations.csv --language en` 更新指定语言，并审阅 JSON 差异。缺行保留原资源，重复键、未知键、空译文及参数不一致会拒绝导入。英文计数使用 `_one`／`_other`；新增语言按注册表声明自己的复数形式。源文变化时检查要求重新审阅译文，再更新 context 中记录的源文。

新增语言先在注册表登记 BCP 47 标识、自称名称、HTML／日期区域、方向、复数形式和 `complete: false`，再添加资源文件。完成资源与布局审阅后才启用；RTL 语言需要单独审阅布局。注册表随服务分发，前端在构建时引用同一文件。
