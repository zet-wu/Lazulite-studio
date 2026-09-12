# Features：用户操作与工作区

后续按需要创建 projects、upload、lyric-candidates、editor、timeline、agents、jobs、preview、export；Ruby 和细粒度编辑逐阶段加入。

功能组件把用户意图转成领域命令，经公共接口调用服务；选择、弹窗和面板状态可以局部保存。功能之间通过组合层协调，不读取对方组件私有状态，不直接修改权威文档。

每项功能应覆盖加载、空态、失败、只读和能力未配置状态。机器任务完成进入提案复核，不自动替换歌词。

## 当前实现

S4 工作区组合行表、属性/复核、歌手管理与导入/任务候选面板。`useProjectDocument` 管理编辑副本、串行自动保存及恢复；候选组件只输出领域命令，不自行写服务器。任务通过 HTTP adapter 访问持久队列，媒体控制沿用 S3。`/editor` 保留本地 TTML 工作流。
