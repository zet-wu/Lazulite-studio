# Features：用户操作与工作区

`editor/EditorWorkspace.tsx` 与菜单、Ribbon、歌词列表、行词交互组件是本地 `/editor` 与项目路由共用的语义编辑界面，可修改行、词、Ruby、时间、翻译、音译、背景、歌手和常见元数据。`editor/LocalEditor.tsx` 负责本地文件与当前版本检查点；`Workspace.tsx` 负责项目加载、revision 保存、候选、任务、词典、审核及媒体入口。两者调用同一领域命令与 TTML codec。

`useProjectDocument.ts` 管理撤销重做、串行保存、冲突和本地恢复。`CandidatePanel` 与 `JobCandidatePanel` 将候选转为一次领域事务，不直接改服务器文档。`MediaTransport` 保留播放和波形控制，`ExportPage` 下载或发布已保存的语义文档。

`editor/editing-actions.ts` 负责有序选择、带 Ruby/时间/对齐的内部剪贴板、纯文本插入和跨行词事务；`SegmentationPanel` 与 `BatchToolsPanel` 调用相同命令历史。`SyncPanel` 使用播放器时钟连续打轴，`TimelineTracks` 提交拖动事务，`PreviewMode` 延迟加载 AMLL 并读取当前草稿。音译附属行和显式 Ruby 提案已接入。普通与超过80行的虚拟列表共用显式定位、真实高度校准和取消语义；时间轴三类区间独立分轨、共享绘图区，窄区间使用既有缩放后普通端点编辑，不设专属工具行。实际状态与剩余差距见[当前状态](../../../../lyric-workflow/docs/studio/current-state.md)。

`SpectrogramCanvas` 按资产身份持有有界强度LRU、2个在途请求与独立Worker生命周期；固定384×96/FFT512、两侧样本上下文、整数设备像素边界，取消/错误/过期结果显式处理。

底部播放/时间/三角入口持续挂载；收起自然高度，高亮独立组合且窄块只染真实颜色。Ruby对话框使用派生默认跳过与手动boolean覆盖，目标/字符输出/源变更按明确事件清理上下文。StudioLyricPlayer在AMLL显示组边界组合父背景区间，保留独立输入时间；AMLL仍按需加载，预览不回写文档。

RubyGenerationDialog对>80提案复用TanStack Virtual，只挂载可见行；源/覆盖选择有界滚动，分配/读音/跳过覆盖仍按完整提案及稳定row key保存。

SettingsDialog 统一固定标题/操作区与滚动内容，分词、批处理、拆行和 Ruby 共用焦点管理。中栏末尾追加空主行，大纲与属性使用固定标题和主行号。object-drag 将明确插入槽位转换为临时布局投影与最终单次命令；指针副本不进入 React 文档状态，槽位变化才重排，保持虚拟化。Ruby 自动扩展必要的正文词/行时间，不保留时间确认 UI；生成与连带时间仍可一次撤销/重做。

Phase 6：`InlineAdd`统一行末词/音译单元的本地新增草稿，支持IME、Enter/blur去重和Esc；输入焦点复用虚拟列表保留行。词正文单击即可编辑，非输入卡片仍拖动，词右键默认分词复用现有领域算法。`TranslationEditor`提供正文、语言校验及垃圾桶删除；`SingerSelection`用复选和混合状态按成员修改歌手引用。主行右键Ruby复用多行对话框，范围按实际非空源统计。音译内容选中使用专用范围高亮，预览空白是独立AMLL文本节点；合唱保存多引用，预览仍仅两侧表达。
