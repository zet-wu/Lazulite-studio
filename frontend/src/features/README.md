# Features：用户操作与工作区

`editor/EditorWorkspace.tsx` 与菜单、Ribbon、歌词列表、行词交互组件是本地 `/editor` 与项目路由共用的语义编辑界面，可修改行、词、Ruby、时间、翻译、音译、背景、歌手和常见元数据。`editor/LocalEditor.tsx` 负责本地文件与当前版本检查点；`Workspace.tsx` 负责项目加载、revision 保存、候选、任务、词典、审核及媒体入口。两者调用同一领域命令与 TTML codec。

`useProjectDocument.ts` 管理撤销重做、串行保存、冲突和本地恢复。`CandidatePanel` 与 `JobCandidatePanel` 将候选转为一次领域事务，不直接改服务器文档。`MediaTransport` 保留播放和波形控制，`PackagingPanel` 下载当前歌词，`MusicPackaging` 保存确切快照后创建媒体打包任务。

`editor/editing-actions.ts` 负责有序选择、带 Ruby/时间/对齐的内部剪贴板、共用原子选区删除、纯文本插入和跨行词事务；`SegmentationPanel` 与 `BatchToolsPanel` 调用相同命令历史。`SyncPanel` 使用播放器时钟连续打轴，`TimelineTracks` 提交拖动事务，`PreviewMode` 延迟加载 AMLL 并读取当前草稿。音译附属行和显式 Ruby 提案已接入。普通与超过80行的虚拟列表共用显式定位、真实高度校准和取消语义；时间轴三类区间独立分轨、共享绘图区，窄区间使用既有缩放后普通端点编辑，不设专属工具行。实际状态与剩余差距见[当前状态](../../../../lyric-workflow/docs/studio/current-state.md)。

`SpectrogramCanvas` 按资产身份持有有界强度LRU、2个在途请求与独立Worker生命周期；固定384×96/FFT512、两侧样本上下文、整数设备像素边界，取消/错误/过期结果显式处理。

底部播放/时间/三角入口持续挂载；收起自然高度，高亮独立组合且窄块只染真实颜色。Ruby对话框使用派生默认跳过与手动boolean覆盖，目标/字符输出/源变更按明确事件清理上下文。StudioLyricPlayer在AMLL显示组边界组合父背景区间，保留独立输入时间；AMLL仍按需加载，预览不回写文档。

RubyGenerationDialog对>80提案复用TanStack Virtual，只挂载可见行；源/覆盖选择有界滚动，分配/读音/跳过覆盖仍按完整提案及稳定row key保存。

SettingsDialog 统一固定标题/操作区与滚动内容，分词、批处理、拆行和 Ruby 共用焦点管理。中栏末尾追加空主行，大纲与属性使用固定标题和主行号。object-drag 将明确插入槽位转换为临时布局投影与最终单次命令；指针副本不进入 React 文档状态，槽位变化才重排，保持虚拟化。Ruby 自动扩展必要的正文词/行时间，不保留时间确认 UI；生成与连带时间仍可一次撤销/重做。

Phase 6：`InlineAdd`统一行末词/音译单元的本地新增草稿，支持IME、Enter/blur去重和Esc（只有空字符串取消，允许新增纯空格词）；输入焦点复用虚拟列表保留行。词正文单击即可编辑，非输入卡片仍拖动，词右键默认分词复用现有领域算法。`TranslationEditor`提供正文、语言校验及垃圾桶删除；`SingerSelection`用复选和混合状态按成员修改歌手引用。主行右键Ruby复用多行对话框，范围按实际非空源统计。音译内容选中使用专用范围高亮，预览空白是独立AMLL文本节点；合唱保存多引用，预览仍仅两侧表达。

Phase 7：LineSplitDialog上下预览与逐条翻译归属，TranslationEditor自动高度textarea（六行上限）接入既有实测变高列表。TimelineTracks在视窗相交集合上分轨，编辑拖动冻结轨号/高度。RomanizationGenerationDialog复用主行多选，自有只读正文/Ruby与可编辑音译静态排版；普通按行、定时按源单元直接修正文字。打开/模式切换生成一次，应用当前结果，删除旧读音覆盖/跨词确认状态；非阻塞虚线和实际阻塞实线区分。超过80行有界挂载并保留活动输入行；目标既有内容默认跳过，支持明确局部替换。PlaybackSpeed管理即时滑条、滚轮、键盘及1×恢复；MediaTransport始终原生保持音高，换媒体重施，HTMLMediaElement仍是唯一媒体时钟。

编辑模式的“歌词设置”集中元数据、歌手和音译轨道，编辑工具只保留选区操作。EditorWorkspace的pointerFocus标记区分鼠标被动焦点与键盘定位；右键保留已选对象范围，五类删除使用有效选区，不写剪贴板。LocalEditor先同步执行命令再提交状态，失败不进入React渲染或历史；输入原生文本菜单继续保留。

音译生成预览统一读音层和正文行高，无Ruby假名与带Ruby汉字共用正文基线。定时模式的源读音与音译字段共享逐单元列宽和换行规则，字段文字居中；汉字正文居中放在整组Ruby下方，无Ruby正文居中对应自身音译单元。手工修改字段宽度时读音同步排布，长读音组仍保留单份正文。

定时预览把源读音和字段放进同一单元列共同换行，各显示行紧跟对应音译，不先集中显示全部读音再集中显示字段。超长Ruby组的正文只放首显示行，后续读音与字段继续逐行配对。ResizeObserver测量首行和正文高度，只调整已有节点的排版；修改宽度或窗口尺寸不重挂输入，不中断焦点/IME。

音译生成的输出模式是浏览器偏好：项目路由按实际projectId、本地编辑按文件名保存至localStorage，切换模式时更新，取消仍记忆；打开时直接按记忆模式生成一次。仅保存模式，不保留上次手工提案，也不写入歌词文档或撤销历史。

目标轨道每次打开默认选择文档顺序中的第一条ja-Latn，无匹配轨道时默认新建；仍可明确新建或选择其他匹配轨道。默认选中已有轨道时，有内容的源行仍跳过、缺少内容的行可追加，不自动覆盖已有音译。

`LyricAcquisition` 提供文件/文本/网络候选预览与逐键整组元数据选择，确认导入一次事务。`NetworkLyrics` 丢弃过期响应、显示真实粒度并支持网易/QQ 歌曲 ID 独立关联。`useProjectDocument.saveForPackaging` 返回被保存的 document 与 revision，后续编辑不能冒充已保存快照。

`AcquisitionStore` 由 EditorWorkspace 持有最近四源检索、稳定候选及有限预览缓存；`useSearchConditions` 串行保存独立最终字符串。搜索与取词共享每源额度，后台不选择或导入。`OutputIssues` 连接稳定对象 ID 与显式滚动/焦点；歌词下载统一纯 TTML 或所选兼容格式。项目删除广播使已开编辑器失效并清理恢复。


当前注音输入统一单击/Tab 编辑与行内新增；`SingerDialog` 自有表单替代系统输入弹窗。`SyncPanel` 从工作区活动选择读取唯一目标，显示可见行号与行内序号，支持本行停止。`shortcuts.ts` 与 `ShortcutDialog` 统一 12 项本机绑定及焦点冲突路由，编辑/打轴默认等高。`StudioLyricPlayer` 用公开行元素的动画标识同步媒体倍率与相位；`MediaTransport` 视窗投影独立于媒体位置事件。项目列表使用直接删除按钮。

`VocalPanel` 管任务与显式采用，`VocalTracks` 管能量/片段窗口和原子人工编辑。音频处理使用共享大纲、唯一主时间轴 portal 与底部紧凑播放器；播放和图形独立选源。`useProjectDocument` 的运行状态与唯一历史提升到完整项目，歌词导入保留声学部分，检查点不持久化历史。
