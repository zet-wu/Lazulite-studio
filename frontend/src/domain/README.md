# Domain：歌词编辑规则

`lyric-document.ts` 是当前唯一可写文档：行 → 词块 → Ruby 读音单元，以及文档级有序音译轨道。音译轨道按主行 ID 引用正文，单元有独立文本和时间。行另存翻译、背景关联和 agent；词可附着 mora/phoneme 对齐结果。时间为绝对整数微秒或 `null`，正文由词序列投影，不另存一份可写整行文本。

`lyric-commands.ts` 提供纯函数编辑事务、撤销和重做，历史上限为 256 次操作。词和读音使用稳定 ID；拆分位置使用 Unicode code point，并验证 grapheme 边界。带 Ruby 或未分配附属属性的词不能猜测式拆分。命令批次只产生一次历史记录。

`segmentation.ts` 保留原文、词时间端点和空白，全文应用由单次遍历的 `segment-words` 命令完成。`batch-editing.ts` 实现范围时间偏移、CJK 词边界平滑、行时间同步和词内替换。行尾链接的目标与原结束时间存在语义文档中，草稿 TTML 带 Studio 命名空间标记；最终交换文件不带链接编辑状态。

`sync-editing.ts` 处理连续打轴游标和单次落点事务，`timeline-editing.ts` 处理行/词/Ruby 的平移与边界修改；`bpm.ts` 根据峰值估算节拍，`spectrogram.ts` 在 Worker 中计算按需片段。`preview-adapter.ts` 只投影有完整时间的语义文档给 AMLL，不修改草稿。

XML、HTTP、播放和 IndexedDB 均在领域层之外。TTML 导入和当前版本草稿序列化由 `adapters/ttml/lyric-codec.ts` 实现；最终交换文件不包含 Studio 内部 ID 与对齐元数据。旧开发检查点不会自动迁移。音译附属行 UI 与显式 Ruby 生成已接入。背景建立/改绑复用 `set-background-of`，由命令保持父引用、内容归属及各单元自身时间合法性，允许父背景独立绝对时间，拆行归属同样不做父子包含校验。

`pack-intervals.ts` 仅派生时间轴子轨布局，不写入歌词文档或历史；端点相接可复用子轨。

Ruby提案仅在最大重叠>10ms时滤除其他≤10ms边缘候选；全部短候选仍人工分配。defaultRubySkips按目标词全组转换读音与正文作NFC比较，只派生平/片假名相同默认跳过，不改命令或源音译。词/Ruby自身时间合法性和无损内容约束继续保留。

rubyGenerationCommand 直接返回单个 batch，不再接收时间扩展同意开关或输出仅供预览使用的扩展明细。源实际时间不变；必要的词/行包络扩展与 Ruby 设置在同一事务中。没有生成项则拒绝空操作，覆盖、未分配、读音与文档过期、行尾链接检查继续生效。

Phase 6：Ruby源在建立提案时过滤空及纯空白单元，不修改源或参与包络计算。`sublyrics.ts`校验BCP 47风格语言标签并排除空正文翻译，set-sublyrics相同结果不增加历史。默认快捷拆分复用现有分词及时间分配，空白为独立分片，不并入相邻词；预览适配按原顺序保留独立纯空白词为0–0 AMLL word，不修改保存内容。多歌手仍为有序agentRefs，AMLL只按包含主唱与否派生isDuet。
