# Domain：项目与歌词领域规则

领域层只包含纯数据结构与无副作用规则，不依赖浏览器存储或网络请求。`project-document.ts` 维护唯一可编辑的 `ProjectDocument` 与 256 步撤销历史；`lyric-document.ts` 定义行、词、注音、有序翻译/音译轨道、歌手与元数据，所有时间采用整数毫秒（或 `null`），文本范围按 Unicode 码点与字素边界校验。

## 歌词编辑与结构命令

- `lyric-commands.ts`、`line-structure.ts`、`selection-editing.ts`：负责增删改、拆行、合行、合词、合注音、复制粘贴、字形替换、歌手管理与附属轨道编辑，所有复合操作以单次原子事务提交并自动维护引用一致性。
- `segmentation.ts`、`batch-editing.ts`、`translation-editing.ts`：提供按原文边界分词、整体时间偏移、消除行内相邻读音单元之间的短空隙与轻微重叠（可选包含非中日韩读音）、批量清除注音/时间/导唱符与翻译/音译内容归轨。

## 打轴、时间轴与声学

- `reading-units.ts`：按行提取实际参与发音与计时的最小读音单元（有注音的词展开为各个注音，无注音的词取正文词本身）；批处理消除空隙与时间轴空隙轨闭合共用同一套中点闭合与父级时间包络更新规则。
- `sync-editing.ts`：根据当前选区计算连续或本行打轴位置，管理 StrangeUtaGame 与 AMLL 两种风格的节奏点/空拍、终止点（`syncStops`）及跳过连续打轴行。
- `timeline-editing.ts`、`timeline-projection.ts`、`pack-intervals.ts`、`active-lines.ts`：负责时间端点拖动、同行内相邻贴合单元的边界联动、缩放吸附、单侧未定时间对象的显示区计算、多行分轨排布与播放头活动行查找。通过 `WeakMap` 缓存与线性索引避免长文档上的重复扫描。
- `spectrogram.ts`：预计算 1024 点 FFT 旋转因子、Hann 窗与对数频率映射表，按 4 秒窗口生成 512×256 声谱强度瓦片。
- `vocal-editing.ts`、`alignment.ts`：管理人声片段增删改与行时间分配，以及自动对齐结果的范围校验、短空隙合并与父级时间包络更新。

## 注音与罗马字生成

- `japanese-ruby.ts`：结合假名锚点为日文正文切分细粒度注音，支持可选的跨词自动合并（含复合词及数字与常见量词组合）与一步撤销。
- `dictionary-ruby.ts`：将固定词典的注音分段与多音字候选映射到当前文档快照，保留已有的手动时间并按音拍或等分规则为新切分单元分配时间。
- `romanization-generation.ts`、`ruby-generation.ts`：结合行内假名上下文生成日文罗马字音译，以及根据带词级时间的音译轨道反向匹配生成假名注音。

## 兼容与卡拉 OK

- `amll-compatibility.ts`、`preview-adapter.ts`：定义 AMLL 兼容模式检查规则、有效歌手解析与预览组件所需的数据投影。
- `karaoke.ts`、`singer-markers.ts`：管理行前/词间/注音间导唱符、输出分组（含 `main`/`background` 标准角色）、NicoKara 歌手触发标记、SUG 分轨歌手覆盖名称以及逐文件整数毫秒偏移。
