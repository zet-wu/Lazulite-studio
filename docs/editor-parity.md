# 歌词编辑器对齐记录

更新：2026-09-25。参考工具固定为本地 `amll-ttml-tool@10b77c7`，Studio 起点为 `2ff3b2c`。本文件按 [实施计划](lyric-editor-implementation-plan.md) 的编号记录；“待验证”表示没有运行操作或取得截图，不能视为通过。

## E0 环境与基线

- 参考仓库原目录无依赖；为保持它不变，在 `/tmp/lazulite-reference` 安装锁文件指定的 pnpm 11.15.0 依赖并启动 Vite。Studio 用现有前端依赖启动 Vite。Chromium 截图见 `docs/evidence/editor-e0/`，测试窗口为 1440×900、1920×1080 和 390×844。固定试听素材为自制 [10 秒 WAV](../frontend/tests/fixtures/editor-beats.wav)：16 kHz 单声道，每 0.5 秒一次短促强拍，5 秒时音高变化。
- 参考工具的编辑模型见 `src/types/ttml.ts`，TTML 转换模型见 `src/modules/ttml-processor/types/ttml.ts`，两者字段和用途不同。前者含词与 Ruby 子单元；后者含 `translations`、`romanizations`、`backgroundVocal`。
- 参考工具 `src/modules/ttml-processor/index.ts` 区分 AMLL 内嵌和 Apple Music `iTunesMetadata` 两种输出。已用运行中的生成器导出并重新解析 [`reference-rich.ttml`](evidence/editor-e0/reference-rich.ttml)、[`reference-amll-metadata.ttml`](evidence/editor-e0/reference-amll-metadata.ttml) 和 [`reference-apple-metadata.ttml`](evidence/editor-e0/reference-apple-metadata.ttml)。无单位十进制时间是绝对媒体秒；背景词以括号包裹。Apple 样式将翻译和音译放在 head 的 `iTunesMetadata` 中，`x-bg` 容器可不带时间，时间由子词给出。
- 已在参考工具 UI 中重新导入 Ruby 文件，直接将首个读音由“きょ”改为“きよう”，导出并重新解析为两个保留原时间的 Ruby 单元。证据为 [可编辑截图](evidence/editor-e0/reference-ruby-editable-1440.png) 和 [编辑后的导出](evidence/editor-e0/reference-ruby-edited.ttml)。
- 手动分词实操：在参考工具中右击“も歌う”→“拆分单词…”；弹窗显示每个 grapheme 之间的可切换边界，取消第一个边界后确认，词块由“も歌う”变成“も歌”与“う”。见[操作截图](evidence/editor-e0/reference-manual-split-1440.png)。
- 参考工具的“行时间戳”导出会把词块合并为整行，见 [`reference-line-timing.ttml`](evidence/editor-e0/reference-line-timing.ttml)。跨工具 Ruby 验证使用逐字时间导出配置，不能拿整行导出误判为 Ruby 保真。
- Studio 旧入口打开同一参考文件时，将无单位时间报为只读，正文混入翻译、音译和背景；见 [`studio-before-1440.png`](evidence/editor-e0/studio-before-1440.png)。新语义 codec 的 [`studio-roundtrip.ttml`](evidence/editor-e0/studio-roundtrip.ttml) 已由参考工具 `parseTTML` 重新解析，正文、词、两段 Ruby、翻译、音译和背景时间与原样例相等。新 codec 尚未接入编辑页。
- 测试素材将使用自制短句与合成音频，避免依赖商业歌曲或模型下载。双工具互读、长文档和真实媒体样例待生成。

## 操作矩阵

| 编号 | 参考入口与目标操作 | Studio 当前入口与差距 | 样例/验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| UI-01 | `App.tsx`、`components/TopMenu`、`components/RibbonBar`、`components/Sidebar`：编辑/打轴/预览、简单/高级、主题与底部播放 | `features/Workspace.tsx`：单页三栏，缺三模式 | [编辑 1440](evidence/editor-e0/reference-import-1440.png)、[打轴 1440](evidence/editor-e0/reference-sync-1440.png)、[预览 1440](evidence/editor-e0/reference-preview-1440.png)、[高级 1920](evidence/editor-e0/reference-advanced-1920.png)、[深色 390](evidence/editor-e0/reference-edit-dark-390.png)、[Studio 现状](evidence/editor-e0/studio-before-1440.png) | 参考截图已取；功能待实现 |
| ED-01 | `modules/lyric-editor/components/lyric-line-view.tsx`：行词 CRUD、剪贴、多选、拖动 | `LineTable.tsx` 与 `domain/editing.ts`：整行编辑、拆合行 | 无时间中英日混排，排序后撤销/重做 | 待实现 |
| ED-02 | 词属性、背景/对唱及行附属内容 | `AgentPanel.tsx` 已有多歌手；词、背景、翻译/音译缺模型 | 三歌手、重叠背景、空拍与批量修改 | 待实现 |
| SG-01 | `modules/segmentation`：手动/自动/高级分词 | `TimingPanel.tsx` 仅编辑时间单元 | [手动分词实操](evidence/editor-e0/reference-manual-split-1440.png)、[高级分词弹窗](evidence/editor-e0/reference-segmentation-dialog-1440.png)；连空格、标点、忽略词、自定义规则待测试 | 参考手动分词已验证；Studio 功能待实现 |
| RB-01 | `modules/lyric-editor/tools/RubyEditor.tsx`：读音子块拆合与计时 | `RubyPanel.tsx` 整体 Ruby，`TimingPanel.tsx` 另管计时 | [Ruby 可编辑截图](evidence/editor-e0/reference-ruby-editable-1440.png)、[编辑后导出](evidence/editor-e0/reference-ruby-edited.ttml)；新模型命令与往返单测 | 参考 UI 可编辑已验证；Studio 界面待实现 |
| TM-01 | `sync-keybinding.tsx`、`TouchSyncPanel`：连续打轴与导航 | 数值时间编辑及拖动，缺连续游标 | 真实音频键盘打轴及模式切换 | 待实现 |
| TM-02 | `modules/spectrogram/hooks/useTimelineEditing.ts`：偏移、平滑、链接、拖动 | 行整体移动及单元边界已有 | 时间缺口、重叠、链接、拖动撤销 | 待实现 |
| AU-01 | `modules/audio`、`modules/spectrogram`、`Sidebar/BpmPanel.tsx`：频谱、BPM、试听 | `MediaTransport.tsx` 已有播放、速度、波形、循环 | [10 秒合成音频的展开时间轴](evidence/editor-e0/reference-timeline-1440.png)；10 分钟音频及频谱/BPM 实操待测 | 短音频布局已取；长音频功能待验证 |
| PV-01 | `components/AMLLWrapper`、预览模式 | 无动态歌词预览 | Ruby/背景/对唱/译文的真实渲染截图 | 待实现 |
| IO-01 | `modules/ttml-processor`：TTML 导入/导出及多格式菜单 | `adapters/ttml/codec.ts`：旧 XML 路径模型；本地与项目入口分离 | [参考导出](evidence/editor-e0/reference-rich.ttml)→新 codec→[Studio 导出](evidence/editor-e0/studio-roundtrip.ttml)→参考解析；无时间草稿单测 | Ruby/背景样例已互读；入口与其余格式待实现 |
| ST-01 | 同一操作事务、输入历史、保存恢复 | `domain/editing.ts` 20 个快照；`useProjectDocument.ts` revision/ETag | 保存中继续编辑、冲突、刷新恢复 | 待验证 |
| UX-01 | 快捷键、IME、弹窗、触屏、变高长列表 | `LineTable.tsx` 固定行高 | 2,000 行/20,000 词与移动视口 | 待实现 |

## 已知格式映射

| 语义 | 已从源码确认的方向 | 未验证的问题 |
| --- | --- | --- |
| 正文词 | 参考导出在 `p` 内使用定时 `span`，`itunes:key` 为行标识；无单位数字是绝对秒 | 空白归属、无时间词、词 ID 仍待更多样例 |
| Ruby | `tts:ruby="container"` 下 `base` 与 `textContainer`，后者内多个 `tts:ruby="text"` 定时 span | 整体读音的其他编码及时间继承仍待测 |
| 翻译/音译 | AMLL 样式为行内 `span ttm:role="x-translation"` / `x-roman`；Apple Music 样式为 head 内 `iTunesMetadata/translations/translation/text[@for]` 与 `transliterations` | 逐词音译仍待测 |
| 背景 | 主 `p` 内 `span ttm:role="x-bg"`，内部词带括号；Apple 样式的容器可无时间，时间从子词推导 | 多背景、歌手及对唱属性仍待测 |
| 元数据/角色 | `amll:meta key="musicName"/"artists"` 对应标题/艺人；`iTunesMetadata/songwriters/songwriter` 对应作者；`itunes:songPart` 位于 `div`；`ttm:agent` 位于 `p` | 更多字段与重复值顺序仍待测 |

E0 退出条件尚未满足：全部焦点状态、对唱编码和更多元数据仍缺证据。390px 参考页面的主画布受到大纲挤压，[深色截图](evidence/editor-e0/reference-edit-dark-390.png)已记录；Studio 实现须满足计划要求的移动端操作，不照搬这一布局缺陷。后续提交应逐项更新证据和状态，不填写总体完成率。
