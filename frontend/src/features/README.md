# Features：用户操作与工作区

`editor/EditorSurface.tsx` 是本地 `/editor` 与项目路由共用的语义编辑界面，可修改行、词、Ruby、时间、翻译、音译、背景、歌手和常见元数据。`editor/LocalEditor.tsx` 负责本地文件与当前版本检查点；`Workspace.tsx` 负责项目加载、revision 保存、候选、任务、词典、审核及媒体入口。两者调用同一领域命令与 TTML codec。

`useProjectDocument.ts` 管理撤销重做、串行保存、冲突和本地恢复。`CandidatePanel` 与 `JobCandidatePanel` 将候选转为一次领域事务，不直接改服务器文档。`MediaTransport` 保留播放和波形控制，`ExportPage` 下载或发布已保存的语义文档。

E1 已完成文档闭环；E2 起继续实现参考工具的主画布工作流、选择与焦点反馈。自动/高级分词、连续打轴和动态预览分别属于后续阶段，见[实施计划](../../../docs/lyric-editor-implementation-plan.md)。
