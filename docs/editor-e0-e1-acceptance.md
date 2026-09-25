# 歌词编辑器 E0–E1 验收记录

日期：2026-09-25。依据：[实施计划](lyric-editor-implementation-plan.md)的阶段退出条件。结论：**E0 未通过，E1 未通过**。已通过的单项不替代阶段验收。

## E0：行为与视觉基线

| 退出条件 | 核查结果 |
| --- | --- |
| 操作清单与截图作为验收规格 | [对齐矩阵](editor-parity.md)已覆盖计划各大工作项；编辑、打轴、预览、布局、Ruby、分词弹窗和时间轴有运行截图。手动分词细节、全部焦点状态、对唱仍无可复现操作证据，未通过。 |
| Ruby 文件在参考工具重开且可编辑 | 通过。参考 UI 重新导入后可编辑两个词上的三个读音框；修改首框、导出并重解析后，Ruby 单元时间仍保留。见[截图](evidence/editor-e0/reference-ruby-editable-1440.png)及[导出文件](evidence/editor-e0/reference-ruby-edited.ttml)。 |
| 关键模型决策无未说明的双轨状态 | 文档已明确词块和 Ruby 为唯一可写序列、会话与交换格式分离；但旧模型仍负责两个产品入口，因此实施层面未通过。 |

两种参考工具导出样例：[AMLL](evidence/editor-e0/reference-amll-metadata.ttml)、[Apple Music](evidence/editor-e0/reference-apple-metadata.ttml)。已核对标题、艺人、作者、段落、agent、译文、音译、背景、Ruby 与空白。更多元数据与对唱的编码仍待取证。

## E1：编辑文档与 TTML 闭环

| 退出条件 | 核查结果 |
| --- | --- |
| 无时间纯文本可拆词 | 新领域命令的行为测试通过，空白及稳定词 ID 保留。 |
| Ruby、翻译、背景导入→修改→撤销→保存→重开 | 新语义 codec 和命令的测试通过；AMLL 与 Apple 样例均通过。Studio 输出也已由参考工具运行时解析。当前仅为领域层闭环。 |
| 正文投影正确 | 服务端针对参考富文本样例的投影测试已通过；项目入口未切换新 codec，端到端未通过。 |
| 每次操作有稳定 ID | 新命令的拆词、读音拆分和撤销测试通过；两个 UI 入口尚未使用这些命令。 |
| 替换旧模型、共用本地/项目编辑状态及恢复格式 | 未完成。`/editor` 仍使用 `LocalEditor` 与旧 `domain/editing.ts`；项目仍使用 `Workspace.tsx` 和旧 `useProjectDocument` 状态。旧 codec 与新 codec 并存仅是开发过渡，不能验收为单一实现。 |

下一步按 E1 剩余项切换项目保存、恢复和两个入口，再删除旧实现；随后开展 E2 画布。旧开发草稿应重新导入，不自动删除用户数据。
