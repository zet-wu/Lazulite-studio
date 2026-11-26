# Features：工作区与交互模块

`Workspace` 负责项目加载、保存/恢复、资源刷新与冲突处理；`editor/EditorWorkspace` 组合歌词获取、音频处理、编辑、打轴、AMLL 预览、卡拉 OK 与文件打包七个界面模式，共享同一份项目草稿、撤销历史与播放状态。

## 编辑画布、选区与快捷键

- `LyricList`、`SyncPanel`、大纲与属性栏共用 `SelectionContext` 的有效选区；高级编辑模式使用虚拟列表并按模式独立保存滚动位置与高度缓存，`selection-recovery.ts` 在删除或撤销后自动恢复最近的存续焦点。
- `object-drag.ts` 与 `editing-actions.ts` 处理指针拖动、插入指示线、边缘自动滚动与共享右键菜单；单独复制词、注音或计时附属单元粘贴时会自动清空时间，整行粘贴及按住修饰键复制拖动词时保留时间；`InlineAdd` / `SongPartField` 保护中文与日文 IME 组合输入。
- 非文本输入状态下空格键切换播放/暂停，快捷键设置支持冲突提示与单项重置。

## 媒体播放、时间轴与声谱图

- `MediaTransport` 维护全局播放器、变速、A/B 循环与播放跟随，在音频处理页通过 Portal 将时间轴挂入主工作区。
- `TimelineTracks`、`TimelineStaging`、`VocalTracks` 与 `SpectrogramCanvas` 共享同一水平视窗与毫秒坐标系：支持从暂存区拖入分配时间、拖回清空时间、吸附预览与滚轮缩放/平移；默认直接拖动同行内首尾贴合的边界会联动调整前后两个单元，按住 `Ctrl／⌘` 拖动则单侧调整（可在设置中互换默认手势）。声谱图使用常驻 Web Worker 异步计算瓦片，连续就绪的瓦片先按原始像素拼接后再统一缩放到屏幕画布，保证跨瓦片边界平滑过渡。
- `FloatingTray`、`useProjectJobs` 与 `useBackgroundJobRecovery` 在右下角可折叠浮层中统一展示项目外部修订同步提醒、后台任务进度与取消按钮，以及跨刷新未消费的人声分离和自动对齐结果恢复入口；`VocalPanel` 与 `AlignmentPanel` 负责发起任务并在当前页面直接应用结果。

## 语言工具与卡拉 OK 交互

- **注音与文字工具**：`JapaneseRubyDialog`（智能日文注音）、`DictionaryRubyDialog`（词典注音与聚焦候选浮层）、`RomanizationGenerationDialog`（生成日文罗马字音译）、`RubyGenerationDialog`（从音译生成注音）与 `ShapeConversionDialog`（简繁/中日汉字转换）共用源快照校验与可编辑预览，确认后以单次撤销事务提交。
- **管理弹窗**：`SingerDialog`（歌手管理）、`TranslationTrackDialog`（翻译/音译轨道管理）、`DictionaryManager`（词典安装）、`DeviceSettings` / `VocalModels` / `AlignmentDefaults`（模型与计算设置）以及 `StudioSettings`（外观、打轴、时间轴、快捷键与语言偏好）。
- **卡拉 OK**：`KaraokeTools`、`KaraokeTrack`、`SingerMarkersDialog` 与 `SugSingersDialog` 提供分组管理、导唱符编辑、NicoKara 歌手标记和 SUG 歌手名称映射。卡拉 OK 画布沿用简洁编辑的“读音／正文”两行排版，打轴节奏标记与进度仅在打轴界面展示。

## 歌词获取与导出打包

- `LyricAcquisition`、`NetworkLyrics` 与 `useSearchConditions` 整合本地文件/纯文本（含 SUG 0.3.0 项目文件导入）、源音频内嵌歌词与四个在线源搜索。
- `PackagingPanel` 与 `MusicPackaging` 分为“歌词导出”和“音乐文件嵌入”两个页签：前者提供统一的内容分组选择、逐文件全局偏移与针对当前目标格式的实时问题校验；后者基于当前已保存修订实时生成内嵌歌词的音频文件并流式下载。
