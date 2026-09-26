# E4 Ruby 与音译编辑验收

日期：2026-09-26。结论：**E4 的行内 Ruby、逐词音译、生成预览与读音候选路径已实施并验证**。连续打轴游标归 E5，波形时间轴拖动归 E6。

## 可操作结果

- 主画布在 base 上方显示 Ruby 单元。可以添加、插入、修改、删除，用 F8 在光标处拆分、在单元开头用 Backspace 合并，也可按拍拆分及重新分配 Ruby 时间。选中读音单元会定位到对应词；读音时间与正文词时间保持约束。相邻词可一次合成整体 Ruby base；正文输入末尾的 `|` 打开 Ruby 输入，这是参考工具 `parseRubyShortcut` 的语法。
- 逐词音译可以在词下直接编辑。“音译与 Ruby…”按当前行、选中词或行、行号范围或全文生成预览。行音译恰好按空格对应词时直接分配；连写日语使用纯假名词作锚点。多个词共用一段读音时显示提示并留空，用户可在预览中修正。罗马字转假名后按拍拆成 Ruby 单元；纯假名词不重复生成，混合 emoji 的 base 提示手动处理。默认保留已有手动 Ruby，勾选后才覆盖。一次应用对应一次撤销。
- reading 候选仍须与当前 revision/asset 匹配，且文档无未保存修改。候选覆盖连续多个完整词时，应用时先合成整体 base 再添加读音；重叠候选和已有 Ruby/附属属性不会覆盖。
- 草稿 TTML 用 `studio:romanization` 保存无时间逐词音译；最终 TTML 用参考工具实际导出的 `iTunesMetadata/transliterations/transliteration/text[@for]/span` 结构保存有时间逐词音译。最终导出遇到无时间逐词音译或背景词逐词音译时明确报错，避免静默丢失。

## 验证记录

| 项目 | 结果 |
| --- | --- |
| Ruby 拆合、时间端点、整体 base、撤销、假名/罗马字、拗音、促音、长音和 emoji | `frontend/tests/ruby-editing.test.ts`、`frontend/tests/romanization.test.ts` 通过 |
| 逐词音译双向 TTML | [参考工具导出](evidence/editor-e4/reference-word-roman.ttml)由 Studio 导入并导出为[Studio 文件](evidence/editor-e4/studio-word-roman.ttml)；参考工具 WASM `parseTtml` 重新解析后读到 `kyou/sora` 两个定时词、`きょ/う/そら` 三个 Ruby 单元及原时间；`frontend/tests/lyric-codec.test.ts` 通过 |
| 画布操作与预览 | Chromium 实操 Ruby 的 Backspace/F8/快捷输入、整体 base，以及行音译预览→生成→最终导出→撤销→重开；[390px 预览截图](evidence/editor-e4/studio-romanization-390.png)、[390px 行内 Ruby](evidence/editor-e4/studio-ruby-390.png) |
| 阶段回归 | 前端 typecheck、生产构建、59 项单元/集成测试、28 项 Chromium 浏览器测试通过 |

## 使用边界

- 没有明确词间对应关系时，预览要求人工分配读音；不会猜测两个汉字词如何切分同一串假名。手动整体读音不依赖自动假名转换。
- 生成读音时采用均分拍数的初始时间。精确边界可在 Ruby 时间字段编辑，E5/E6 将提供连续打轴和可拖动时间轴。
- 本阶段验证了参考工具解析器对 Studio 最终 TTML 的读取；未把完整参考编辑器 UI 中的再次编辑计入已验证结果。
