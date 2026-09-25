# 歌词编辑器 E0–E1 验收记录

日期：2026-09-25。依据：[实施计划](lyric-editor-implementation-plan.md)的阶段退出条件。结论：**E0、E1 均通过**。E2 及后续工作项按[对齐矩阵](editor-parity.md)继续跟踪。

## E0：行为与视觉基线

| 退出条件 | 核查结果 |
| --- | --- |
| 操作清单与截图作为验收规格 | 通过。[对齐矩阵](editor-parity.md)覆盖计划各大工作项；编辑、打轴、预览、布局、Ruby、手动分词、对唱和时间轴有运行截图。正文词和 Ruby 输入焦点已实操验证。更多格式及元数据字段归 E7 覆盖。 |
| Ruby 文件在参考工具重开且可编辑 | 通过。参考 UI 重新导入后可编辑两个词上的三个读音框；修改首框、导出并重解析后，Ruby 单元时间仍保留。见[截图](evidence/editor-e0/reference-ruby-editable-1440.png)及[导出文件](evidence/editor-e0/reference-ruby-edited.ttml)。 |
| 关键模型决策无未说明的双轨状态 | 通过。实施计划已确定词块和 Ruby 为唯一可写序列、会话与交换格式分离、切换后删除旧实现。当前代码的临时双轨属于 E1 尚未完成的实施问题，不再混入 E0 的规格验收。 |

两种参考工具导出样例：[AMLL](evidence/editor-e0/reference-amll-metadata.ttml)、[Apple Music](evidence/editor-e0/reference-apple-metadata.ttml)。已核对标题、艺人、作者、段落、agent、译文、音译、背景、Ruby 与空白；[对唱关闭导出](evidence/editor-e0/reference-duet-off.ttml)确认 `v2`→`v1`。更多元数据仍待取证。

## E1：编辑文档与 TTML 闭环

| 退出条件 | 核查结果 |
| --- | --- |
| 无时间纯文本可拆词 | 词块命令和当前共用编辑界面均可操作；拆分保留空白、稳定词 ID，使用 grapheme 边界校验。领域行为测试通过。 |
| Ruby、翻译、背景导入→修改→撤销→保存→重开 | AMLL、Apple 样例经语义 codec 往返；项目浏览器测试实操导入 Apple TTML、修改 Ruby、撤销重做、自动保存、离开再打开，Ruby、翻译和背景仍在。`/editor` 浏览器测试覆盖本地文件、草稿导出和检查点恢复历史。 |
| 正文投影正确 | 服务端 AMLL、Apple 样例投影测试通过；Studio 语义 codec 的产物经真实 FastAPI 保存、重开及歌词文件读取通过，Ruby、翻译和背景不混入正文。 |
| 每次操作有稳定 ID | 行、词、Ruby 单元以 ID 操作；拆词与 Ruby 拆分、撤销的领域测试通过。草稿 TTML 保留内部 ID，重开项目后继续定位编辑。 |
| 替换旧模型、共用本地/项目编辑状态及恢复格式 | 两个入口共用 `EditorWorkspace`（E2 阶段改名）、语义命令和 `lyric-codec`；本地和项目检查点统一使用 `studio-lyric-v3` 状态。旧 `text + ruby[] + timingUnits[]` 模型及组件、测试已删除。项目仍使用原 revision/ETag API。 |

验证：前端类型检查、生产构建、33 项单测、8 项 Chromium 浏览器测试，以及后端 36 项测试通过。E1 浏览器测试使用 mock 服务；另以真实 FastAPI 测试覆盖 Studio 语义 TTML 的保存与重开。项目保存队列及本地恢复的行为测试保留。旧开发草稿使用旧 IndexedDB/schema，不自动迁移；应从原 TTML 重新导入，旧库与用户文件未删除。E2 将继续完成主画布布局、选择反馈与完整词操作工作流。
