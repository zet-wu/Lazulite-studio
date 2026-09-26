# Domain：歌词编辑规则

`lyric-document.ts` 是当前唯一可写文档：行 → 词块 → Ruby 读音单元。行另存翻译、音译、背景关联和 agent；词可附着 mora/phoneme 对齐结果。时间为绝对整数微秒或 `null`，正文由词序列投影，不另存一份可写整行文本。

`lyric-commands.ts` 提供纯函数编辑事务、撤销和重做，历史上限为 256 次操作。词和读音使用稳定 ID；拆分位置使用 Unicode code point，并验证 grapheme 边界。带 Ruby 或未分配附属属性的词不能猜测式拆分。命令批次只产生一次历史记录。

`segmentation.ts` 保留原文、词时间端点和空白，全文应用由单次遍历的 `segment-words` 命令完成。`batch-editing.ts` 实现范围时间偏移、CJK 词边界平滑、行时间同步和词内替换。行尾链接的目标与原结束时间存在语义文档中，草稿 TTML 带 Studio 命名空间标记；最终交换文件不带链接编辑状态。

XML、HTTP、播放和 IndexedDB 均在领域层之外。TTML 导入和当前版本草稿序列化由 `adapters/ttml/lyric-codec.ts` 实现；最终交换文件不包含 Studio 内部 ID 与对齐元数据。旧 `text + ruby[] + timingUnits[]` 模型已移除，旧开发检查点不会自动迁移。
