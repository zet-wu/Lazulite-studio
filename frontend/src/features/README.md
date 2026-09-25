# Features：用户操作与工作区

当前项目工作区由 `Workspace.tsx` 组合：

- `LineTable`、`LineInspector`：整行正文、行时间和拆合。
- `RubyPanel`、`TimingPanel`：整体读音与正文/读音时间单元精修。
- `AgentPanel`、`ReadingDictionaryPanel`、`ReviewPanel`：歌手/组合、词典和复核。
- `CandidatePanel`、`JobPanel`、`JobCandidatePanel`：导入、任务和人工应用候选。
- `MediaTransport`：播放、倍速、窗口波形、定位及 A/B/行/单元循环。
- `ExportPage`：已保存修订的 STPP 发布、报告与下载。

`useProjectDocument` 管理编辑副本、撤销重做、串行保存、冲突和带 base revision 的本地检查点。候选通过领域命令应用，不直接覆盖服务器文档。`editor/LocalEditor` 是独立的本地基础编辑入口。

当前尚无完整词块直接编辑、自动/高级分词、连续键盘打轴和 AMLL 动态预览。[下一阶段](../../../docs/lyric-editor-implementation-plan.md)重建画布并统一两个编辑入口；现有任务和词典保留为辅助功能。
