# Features：工作区与交互模块

`Workspace` 负责项目加载、保存/恢复、资源刷新与冲突处理；`editor/EditorWorkspace` 组合歌词获取、音频处理、编辑、打轴、预览、卡拉 OK 与导出打包七个模式，共享同一份项目草稿、撤销历史与播放状态。

## 编辑画布、选区与快捷键

- `LyricList`、`SyncPanel`、大纲与属性栏共用 `SelectionContext` 的有效选区；虚拟列表保持活动输入框挂载，`selection-recovery.ts` 在删除或撤销后自动恢复最近的存续焦点。
- `object-drag.ts` 与 `editing-actions.ts` 处理指针拖动、插入线、边缘滚动与共享右键菜单；`InlineAdd` / `SongPartField` 保护中文/日文 IME 输入。
- 非输入状态下空格键固定切换播放/暂停，快捷键配置支持冲突提示与单项重置。

## 媒体播放、时间轴与声谱图

- `MediaTransport` 维护全局唯一播放器、变速、A/B 循环与播放跟随，在音频页通过 Portal 将时间轴挂入主工作区。
- `TimelineTracks`、`TimelineStaging`、`VocalTracks` 与 `SpectrogramCanvas` 共享同一水平视窗与毫秒坐标：支持从暂存区拖入分配时间、拖回清空时间、吸附预览与滚轮缩放/平移；声谱图使用常驻 Web Worker 异步渲染瓦片。
- `FloatingTray`、`useProjectJobs` 与 `useBackgroundJobRecovery` 在右下角可折叠、可拖动浮层中统一承接项目修订外部同步通知、活动后台任务进度与取消操作，以及跨刷新/跨标签页的未消费后台人声与对齐结果恢复闭环；`VocalPanel` 与 `AlignmentPanel` 负责发起对应任务并在本页直连时协调认领。

## 语言工具与卡拉 OK 交互

- **注音与文字工具**：`JapaneseRubyDialog`（智能日文注音）、`DictionaryRubyDialog`（词典注音）、`RomanizationGenerationDialog`（生成日文罗马字音译）、`RubyGenerationDialog`（从音译生成注音）与 `ShapeConversionDialog`（字形转换）共用源快照校验与可编辑预览，确认后以单次撤销提交。
- **管理弹窗**：`SingerDialog`（歌手管理）、`TranslationTrackDialog`（翻译/音译轨道）、`DictionaryManager`（词典安装）、`DeviceSettings` / `VocalModels` / `AlignmentDefaults`（模型与设备管理）以及 `StudioSettings`（外观、时间轴、快捷键与语言偏好）。
- **卡拉 OK**：`KaraokeTools`、`KaraokeTrack`、`SingerMarkersDialog` 与 `SugSingersDialog` 提供分组管理、导唱符编辑、NicoKara 歌手标记和 SUG 歌手名称覆盖。

## 歌词获取与导出打包

- `LyricAcquisition`、`NetworkLyrics` 与 `useSearchConditions` 整合本地文件/纯文本（含 SUG 导入）、源音频内嵌歌词与四个在线源搜索。
- `PackagingPanel` 与 `MusicPackaging` 分为「歌词导出」和「音乐文件打包」两个页签：前者支持统一内容选择、逐文件偏移与各格式实时导出校验，后者提交已保存修订实时打包下载；`useAutomaticValidation` 负责 AMLL 兼容检查。
