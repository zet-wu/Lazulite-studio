# Domain：歌词编辑规则

当前 `document.ts` 定义 `StudioLyricDocument`、行、整体 Ruby、正文/读音时间单元、agent/group 与 XML 来源信息。行仍以 `text + ruby[] + timingUnits[]` 表达，尚无参考工具式完整词块序列。

时间使用绝对整数微秒/null；正文和读音范围使用独立的 Unicode code point 半开区间。XML 解析在 adapter，领域层不依赖 React、DOM、HTTP 或模型后端。

`editing.ts` 提供行/批量更新、Ruby、时间单元、行移动/边界、拆合、agent 更新和文档替换，历史上限为 20 个快照。`structure.ts` 实现行拆合，`timing.ts` 实现细粒度校验和操作。修改正文目前会清除该行时间单元，并受到 Ruby 范围约束；复杂未知结构仍可能只读。

ID 与来源 XML 路径仍存在关联，结构操作需要维护来源信息。这是当前实现，不是下一阶段必须延续的设计。[编辑器重构计划](../../../docs/lyric-editor-implementation-plan.md)将直接替换为行/词/Ruby 单元模型，不增加旧内部数据兼容层。
