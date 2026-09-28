# Features：用户操作与工作区

`editor/EditorWorkspace.tsx` 与菜单、Ribbon、歌词列表、行词交互组件是本地 `/editor` 与项目路由共用的语义编辑界面，可修改行、词、Ruby、时间、翻译、音译、背景、歌手和常见元数据。`editor/LocalEditor.tsx` 负责本地文件与当前版本检查点；`Workspace.tsx` 负责项目加载、revision 保存、候选、任务、词典、审核及媒体入口。两者调用同一领域命令与 TTML codec。

`useProjectDocument.ts` 管理撤销重做、串行保存、冲突和本地恢复。`CandidatePanel` 与 `JobCandidatePanel` 将候选转为一次领域事务，不直接改服务器文档。`MediaTransport` 保留播放和波形控制，`ExportPage` 下载或发布已保存的语义文档。

`editor/editing-actions.ts` 负责有序选择、带 Ruby/时间/对齐的内部剪贴板、纯文本插入和跨行词事务；`SegmentationPanel` 与 `BatchToolsPanel` 调用相同命令历史。`SyncPanel` 使用播放器时钟连续打轴，`TimelineTracks` 提交拖动事务，`PreviewMode` 延迟加载 AMLL 并读取当前草稿。音译附属行和显式 Ruby 提案已接入。普通列表与超过 80 行的虚拟列表当前定位行为不同；时间轴重叠区间仍共用单行绘制。实际状态与剩余差距见[当前状态](../../../../lyric-workflow/docs/studio/current-state.md)。
