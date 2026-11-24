# Domain：项目与歌词领域规则

领域层只包含纯数据结构与无副作用规则，不依赖浏览器存储或网络请求。`project-document.ts` 维护唯一可编辑的 `ProjectDocument` 与 256 步撤销历史；`lyric-document.ts` 定义行、词、注音、有序翻译/音译轨道、歌手与元数据，所有时间采用整数毫秒（或 `null`），文本切片按 Unicode 码点与字素边界校验。

## 歌词编辑与结构命令

- `lyric-commands.ts`、`line-structure.ts`、`selection-editing.ts`：负责增删改、拆行、合行、合词、合注音、复制、字形替换、歌手管理与附属内容编辑，所有复合操作以单次原子事务提交并自动维护引用一致性。
- `segmentation.ts`、`batch-editing.ts`、`translation-editing.ts`：提供按原文边界分词、时间偏移、消除相邻词间空隙、批处理替换、清除注音/导唱符与翻译/音译轨道归轨。

## 打轴、时间轴与声学

- `sync-editing.ts`：从有效选区派生连续/本行打轴游标，处理 SUG／AMLL 检查点、词内节奏点／空拍、终止点及忽略打轴行。
- `timeline-editing.ts`、`timeline-projection.ts`、`pack-intervals.ts`、`active-lines.ts`：负责时间端点拖动、同行贴合叶子单元的原子边界联动及重合首尾注音保护、缩放吸附、单端未定对象的显示投影、分轨排布与播放头活动行快速查找。`WeakMap` 缓存与线性索引避免长文档上的重复扫描。
- `spectrogram.ts`：预计算 1024 点 FFT 旋转因子、Hann 窗与对数频率映射表，以相邻频率 bin 幅值插值生成512×256强度瓦片；不足4秒的末片沿用固定时间采样网格，由渲染端裁掉未使用尾部。
- `vocal-editing.ts`、`alignment.ts`：管理人声片段增删改与时间分配，以及自动对齐结果的范围校验、空隙合并与包络重算。

## 注音与罗马字生成

- `japanese-ruby.ts`：结合假名锚点为日文正文切分细粒度注音，支持可选的最小跨词合并与撤销事务。
- `dictionary-ruby.ts`：将固定词典的注音分段与歧义提案映射到当前文档快照，保留已有手动时间并按音拍或等分分配新时间。
- `romanization-generation.ts`、`ruby-generation.ts`：按行内假名上下文生成日文罗马字音译，以及根据定时音译的时间重叠反向匹配生成注音。

## 兼容与卡拉 OK

- `amll-compatibility.ts`、`preview-adapter.ts`：定义 AMLL 兼容模式限制、有效歌手解析与预览投影。
- `karaoke.ts`、`singer-markers.ts`：管理行前/词间/注音间导唱符、输出分组（含 `main`/`background` 标准角色）、NicoKara 歌手触发串与跳过配置、SUG 歌手覆盖名称以及逐文件整数毫秒偏移。
