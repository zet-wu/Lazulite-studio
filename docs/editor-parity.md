# 歌词编辑器对齐记录

更新：2026-09-25。参考工具固定为本地 `amll-ttml-tool@10b77c7`，Studio 起点为 `2ff3b2c`。本文件按 [实施计划](lyric-editor-implementation-plan.md) 的编号记录；“待验证”表示没有运行操作或取得截图，不能视为通过。

## E0 环境与基线

- Studio 前端依赖已存在于 `frontend/node_modules`；参考工具目录没有 `node_modules`。参考工具尚未启动，三种视口、明暗主题和焦点截图均待补。
- 参考工具的编辑模型见 `src/types/ttml.ts`，TTML 转换模型见 `src/modules/ttml-processor/types/ttml.ts`，两者字段和用途不同。前者含词与 Ruby 子单元；后者含 `translations`、`romanizations`、`backgroundVocal`。
- 参考工具 `src/modules/ttml-processor/index.ts` 明确区分 AMLL 内嵌 `x-translation`/`x-roman` 和 Apple Music `iTunesMetadata` 两种输出；设置文案还说明 `x-bg` 的行时间随格式变化。准确 XML 结构与命名空间须通过参考工具真实导出并重新导入确认。
- Studio 当前样例 `frontend/tests/fixtures/ttml-golden.xml` 包含相对时间、Ruby、空白、未知扩展。它不是参考工具导出的互读证据。
- 测试素材将使用自制短句与合成音频，避免依赖商业歌曲或模型下载。双工具互读、长文档和真实媒体样例待生成。

## 操作矩阵

| 编号 | 参考入口与目标操作 | Studio 当前入口与差距 | 样例/验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| UI-01 | `App.tsx`、`components/TopMenu`、`components/RibbonBar`、`components/Sidebar`：编辑/打轴/预览、简单/高级、主题与底部播放 | `features/Workspace.tsx`：单页三栏，缺三模式 | 1440×900、1920×1080、390×844，各模式/主题/焦点截图 | 待验证 |
| ED-01 | `modules/lyric-editor/components/lyric-line-view.tsx`：行词 CRUD、剪贴、多选、拖动 | `LineTable.tsx` 与 `domain/editing.ts`：整行编辑、拆合行 | 无时间中英日混排，排序后撤销/重做 | 待实现 |
| ED-02 | 词属性、背景/对唱及行附属内容 | `AgentPanel.tsx` 已有多歌手；词、背景、翻译/音译缺模型 | 三歌手、重叠背景、空拍与批量修改 | 待实现 |
| SG-01 | `modules/segmentation`：手动/自动/高级分词 | `TimingPanel.tsx` 仅编辑时间单元 | 连空格、标点、忽略词、自定义规则 | 待实现 |
| RB-01 | `modules/lyric-editor/tools/RubyEditor.tsx`：读音子块拆合与计时 | `RubyPanel.tsx` 整体 Ruby，`TimingPanel.tsx` 另管计时 | `今日→きょう`、`宇宙→そら`、emoji | 待实现 |
| TM-01 | `sync-keybinding.tsx`、`TouchSyncPanel`：连续打轴与导航 | 数值时间编辑及拖动，缺连续游标 | 真实音频键盘打轴及模式切换 | 待实现 |
| TM-02 | `modules/spectrogram/hooks/useTimelineEditing.ts`：偏移、平滑、链接、拖动 | 行整体移动及单元边界已有 | 时间缺口、重叠、链接、拖动撤销 | 待实现 |
| AU-01 | `modules/audio`、`modules/spectrogram`、`Sidebar/BpmPanel.tsx`：频谱、BPM、试听 | `MediaTransport.tsx` 已有播放、速度、波形、循环 | 10 分钟合成音频，频谱/BPM 实操 | 待验证 |
| PV-01 | `components/AMLLWrapper`、预览模式 | 无动态歌词预览 | Ruby/背景/对唱/译文的真实渲染截图 | 待实现 |
| IO-01 | `modules/ttml-processor`：TTML 导入/导出及多格式菜单 | `adapters/ttml/codec.ts`：旧 XML 路径模型；本地与项目入口分离 | 双工具互读文件、元数据、未定时间草稿 | 待验证 |
| ST-01 | 同一操作事务、输入历史、保存恢复 | `domain/editing.ts` 20 个快照；`useProjectDocument.ts` revision/ETag | 保存中继续编辑、冲突、刷新恢复 | 待验证 |
| UX-01 | 快捷键、IME、弹窗、触屏、变高长列表 | `LineTable.tsx` 固定行高 | 2,000 行/20,000 词与移动视口 | 待实现 |

## 已知格式映射（待双工具实测）

| 语义 | 已从源码确认的方向 | 未验证的问题 |
| --- | --- | --- |
| 正文词 | TTML `p` 内定时 `span`；Studio 当前 codec 能读基本 span | 参考工具导出的空白归属、无时间词、词 ID |
| Ruby | TTML `tts:ruby="container"` 的 `base`/`text`；Studio 既有样例覆盖整体读音 | 多段读音时间的确切 XML 结构和重开行为 |
| 翻译/音译 | AMLL 样式内嵌 `x-translation`/`x-roman`；Apple Music 样式在 `iTunesMetadata` | 命名空间、语言属性、逐词音译编码 |
| 背景 | 参考工具使用 `x-bg` | 嵌套层级、时间继承、歌手及对唱属性 |
| 元数据/角色 | 参考转换类型含 agents、songwriters、title 等 | 真实属性名、重复值顺序与不同格式差异 |

E0 退出条件尚未满足：参考工具运行截图和 Ruby/背景互读文件缺失。后续提交应逐项更新证据和状态，不填写总体完成率。
