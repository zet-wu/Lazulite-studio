# 歌词编辑器对齐记录

更新：2026-09-25。参考工具固定为本地 `amll-ttml-tool@10b77c7`，Studio 起点为 `2ff3b2c`。本文件按 [实施计划](lyric-editor-implementation-plan.md) 的编号记录；“待验证”表示没有运行操作或取得截图，不能视为通过。

## E0 环境与基线

- 参考仓库原目录无依赖；为保持它不变，在 `/tmp/lazulite-reference` 安装锁文件指定的 pnpm 11.15.0 依赖并启动 Vite。Studio 用现有前端依赖启动 Vite。Chromium 截图见 `docs/evidence/editor-e0/`，测试窗口为 1440×900、1920×1080 和 390×844。固定试听素材为自制 [10 秒 WAV](../frontend/tests/fixtures/editor-beats.wav)：16 kHz 单声道，每 0.5 秒一次短促强拍，5 秒时音高变化。
- 参考工具的编辑模型见 `src/types/ttml.ts`，TTML 转换模型见 `src/modules/ttml-processor/types/ttml.ts`，两者字段和用途不同。前者含词与 Ruby 子单元；后者含 `translations`、`romanizations`、`backgroundVocal`。
- 参考工具 `src/modules/ttml-processor/index.ts` 区分 AMLL 内嵌和 Apple Music `iTunesMetadata` 两种输出。已用运行中的生成器导出并重新解析 [`reference-rich.ttml`](evidence/editor-e0/reference-rich.ttml)、[`reference-amll-metadata.ttml`](evidence/editor-e0/reference-amll-metadata.ttml) 和 [`reference-apple-metadata.ttml`](evidence/editor-e0/reference-apple-metadata.ttml)。无单位十进制时间是绝对媒体秒；背景词以括号包裹。Apple 样式将翻译和音译放在 head 的 `iTunesMetadata` 中，`x-bg` 容器可不带时间，时间由子词给出。
- 已在参考工具 UI 中重新导入 Ruby 文件，直接将首个读音由“きょ”改为“きよう”，导出并重新解析为两个保留原时间的 Ruby 单元。证据为 [可编辑截图](evidence/editor-e0/reference-ruby-editable-1440.png) 和 [编辑后的导出](evidence/editor-e0/reference-ruby-edited.ttml)。
- 手动分词实操：在参考工具中右击“も歌う”→“拆分单词…”；弹窗显示每个 grapheme 之间的可切换边界，取消第一个边界后确认，词块由“も歌う”变成“も歌”与“う”。见[操作截图](evidence/editor-e0/reference-manual-split-1440.png)。
- 对唱实操：选中 `L2` 时参考工具的“对唱歌词”处于勾选状态；关闭后导出的 `L2` 从 `ttm:agent="v2"` 变为 `v1`。见[勾选截图](evidence/editor-e0/reference-duet-1440.png)和[关闭后的导出](evidence/editor-e0/reference-duet-off.ttml)。Studio 语义 codec 按参考的 `v1/v2` 规则映射 `duet` 与 agent。
- 焦点状态实测：双击正文词“も歌う”后焦点落在对应文本 input，直接点击读音“きょ”后焦点落在 Ruby input。见[正文焦点](evidence/editor-e0/reference-word-focus-1440.png)和[Ruby 焦点](evidence/editor-e0/reference-ruby-focus-1440.png)。
- 参考工具的“行时间戳”导出会把词块合并为整行，见 [`reference-line-timing.ttml`](evidence/editor-e0/reference-line-timing.ttml)。跨工具 Ruby 验证使用逐字时间导出配置，不能拿整行导出误判为 Ruby 保真。
- Studio 旧入口打开同一参考文件时，将无单位时间报为只读，正文混入翻译、音译和背景；见 [`studio-before-1440.png`](evidence/editor-e0/studio-before-1440.png)。该入口已被共用语义编辑器替换。新 codec 的 [`studio-roundtrip.ttml`](evidence/editor-e0/studio-roundtrip.ttml) 已由参考工具 `parseTTML` 重新解析，正文、词、两段 Ruby、翻译、音译和背景时间与原样例相等；项目与本地浏览器路径也已验证。
- 测试素材将使用自制短句与合成音频，避免依赖商业歌曲或模型下载。双工具互读、长文档和真实媒体样例待生成。

## 操作矩阵

| 编号 | 参考入口与目标操作 | Studio 当前入口与差距 | 样例/验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| UI-01 | `App.tsx`、`components/TopMenu`、`components/RibbonBar`、`components/Sidebar`：编辑/打轴/预览、简单/高级、主题与底部播放 | 两入口共用 `EditorWorkspace`；E2 已有菜单/Ribbon、画布/大纲和简单/高级布局。三模式、底部时间轴与进一步视觉对齐按 E4–E7 继续 | [编辑 1440](evidence/editor-e0/reference-import-1440.png)、[打轴 1440](evidence/editor-e0/reference-sync-1440.png)、[预览 1440](evidence/editor-e0/reference-preview-1440.png)、[高级 1920](evidence/editor-e0/reference-advanced-1920.png)、[深色 390](evidence/editor-e0/reference-edit-dark-390.png)、[旧 Studio](evidence/editor-e0/studio-before-1440.png)；布局切换浏览器测试 | E0 基线通过；E2 编辑布局通过 |
| ED-01 | `modules/lyric-editor/components/lyric-line-view.tsx`：行词 CRUD、剪贴、多选、拖动 | 共用界面已有行词增删改、拆词、跨行 Ctrl/Cmd 多选和 Shift 范围、全选/反选、内部富词块剪贴板、纯文本粘贴、跨行词移动、词与带背景行拖放排序及 Ctrl 拖动复制；触屏手柄支持排序 | 无时间拆词、ID、Ruby/对齐复制及跨行时间单测；项目和本地浏览器编辑、拖放、剪贴、撤销测试 | E1 基础通过；E2 验收通过 |
| ED-02 | 词属性、背景/对唱及行附属内容 | 语义模型、codec 与共用界面已覆盖背景、agent、翻译、音译；E2 具备歌手/对唱混合值和一次撤销的批量设置 | [对唱勾选截图](evidence/editor-e0/reference-duet-1440.png)、[关闭后导出](evidence/editor-e0/reference-duet-off.ttml)；三歌手、重叠背景、空拍待测试 | E1 模型通过；E2 界面通过 |
| SG-01 | `modules/segmentation`：手动/自动/高级分词 | E3 分词面板可点击 grapheme 边界、预览并应用；自动/高级提供当前行、选中、行范围、全文、CJK/西文音节、标点/空白、忽略词与自定义规则；含 Ruby/附属属性词在预览中跳过 | [390px 手动分词](evidence/editor-e3/studio-manual-390.png)、[1440px 高级规则](evidence/editor-e3/studio-advanced-1440.png)；混排、连空格、音节和一次撤销单测及浏览器实操 | E3 已验证；跨词合并仍用手动词操作 |
| RB-01 | `modules/lyric-editor/tools/RubyEditor.tsx`：读音子块拆合与计时 | 共用界面可编辑、添加、删除 Ruby 及时间；拆分命令已实现，完整 Ruby 工作流归 E4 | [Ruby 可编辑截图](evidence/editor-e0/reference-ruby-editable-1440.png)、[编辑后导出](evidence/editor-e0/reference-ruby-edited.ttml)；语义往返及浏览器闭环 | E1 基础通过；E4 工作流待完成 |
| TM-01 | `sync-keybinding.tsx`、`TouchSyncPanel`：连续打轴与导航 | 数值时间编辑及拖动，缺连续游标 | 真实音频键盘打轴及模式切换 | 待实现 |
| TM-02 | `modules/spectrogram/hooks/useTimelineEditing.ts`：偏移、平滑、链接、拖动 | E3 批处理支持范围时间偏移（含词/Ruby/对齐）、CJK 相邻普通词的阈值平滑、同步行首尾、行尾链接/取消；E6 继续做时间轴拖动与吸附 | [E3 验收](editor-e3-acceptance.md)；负偏移、Ruby 不变、链接草稿往返及浏览器撤销测试 | E3 数值批处理已验证；E6 时间轴待实现 |
| AU-01 | `modules/audio`、`modules/spectrogram`、`Sidebar/BpmPanel.tsx`：频谱、BPM、试听 | `MediaTransport.tsx` 已有播放、速度、波形、循环 | [10 秒合成音频的展开时间轴](evidence/editor-e0/reference-timeline-1440.png)；10 分钟音频及频谱/BPM 实操待测 | 短音频布局已取；长音频功能待验证 |
| PV-01 | `components/AMLLWrapper`、预览模式 | 无动态歌词预览 | Ruby/背景/对唱/译文的真实渲染截图 | 待实现 |
| IO-01 | `modules/ttml-processor`：TTML 导入/导出及多格式菜单 | 两入口共用 `lyric-codec.ts`；TTML 和草稿闭环已验收，其余格式及完整元数据归 E7 | [参考导出](evidence/editor-e0/reference-rich.ttml)→[Studio 导出](evidence/editor-e0/studio-roundtrip.ttml)→参考解析；项目与本地浏览器测试、真实 FastAPI 保存重开 | E1 TTML 闭环通过；E7 格式待完成 |
| ST-01 | 同一操作事务、输入历史、保存恢复 | `lyric-commands.ts` 256 次有界历史，`useProjectDocument.ts` revision/ETag 串行保存，两个入口使用 v3 检查点；E2 已区分选择、焦点与播放头视觉标记，跨行选择和批量属性共用命令历史 | 保存中继续编辑、冲突及恢复单测；本地恢复、项目保存重开、重排撤销和播放头浏览器测试 | E1 核心通过；E2 验收通过 |
| UX-01 | 快捷键、IME、弹窗、触屏、变高长列表 | 当前共用界面处理 IME、Alt+↑/↓ 切词、Alt+←/→ 重排、双击/F2 编辑和 Escape 取消；触屏拖放与变高虚拟列表已验收 | 键盘切词、Escape、390px 视口浏览器测试；[2,000 行/20,000 词及触屏验收](editor-e2-acceptance.md) | E2 验收通过 |

## 已知格式映射

| 语义 | 已从源码确认的方向 | 未验证的问题 |
| --- | --- | --- |
| 正文词 | 参考导出在 `p` 内使用定时 `span`，`itunes:key` 为行标识；无单位数字是绝对秒 | 空白归属、无时间词、词 ID 仍待更多样例 |
| Ruby | `tts:ruby="container"` 下 `base` 与 `textContainer`，后者内多个 `tts:ruby="text"` 定时 span | 整体读音的其他编码及时间继承仍待测 |
| 翻译/音译 | AMLL 样式为行内 `span ttm:role="x-translation"` / `x-roman`；Apple Music 样式为 head 内 `iTunesMetadata/translations/translation/text[@for]` 与 `transliterations` | 逐词音译仍待测 |
| 背景 | 主 `p` 内 `span ttm:role="x-bg"`，内部词带括号；Apple 样式的容器可无时间，时间从子词推导 | 多背景、歌手及对唱属性仍待测 |
| 元数据/角色 | `amll:meta key="musicName"/"artists"` 对应标题/艺人；`iTunesMetadata/songwriters/songwriter` 对应作者；`itunes:songPart` 位于 `div`；`ttm:agent` 位于 `p`，参考对唱使用 `v2`、关闭后为 `v1` | 更多字段与重复值顺序仍待测 |

E0 行为与视觉基线已满足阶段退出条件：关键布局、焦点、Ruby、分词、背景、对唱和常见元数据均有参考操作或双工具样例。更多元数据字段和格式覆盖按 E7 验证；这不改变 E0 对现有常见结构的映射结论。390px 参考页面的主画布受到大纲挤压，[深色截图](evidence/editor-e0/reference-edit-dark-390.png)已记录；Studio 实现须满足计划要求的移动端操作，不照搬这一布局缺陷。后续提交应逐项更新证据和状态，不填写总体完成率。
