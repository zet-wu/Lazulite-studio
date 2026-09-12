# S5：日语 Ruby 工作流

开始：2026-09-12。依据工作流仓库的 [实施计划](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)、[前端架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md) 和 [总体 Ruby 工作流](../../lyric-workflow/docs/lazulite_music_workflow_plan.md)。S4 行级制作闭环已经验收，本阶段在富 TTML 草稿上开放可控的整体读音编辑。

## 开发范围

- `RubySpan` 使用正文 Unicode code point 半开范围与整体 reading，不建立“一字一音”假设。
- 可理解的 TTML2 Ruby 支持新增、修改、删除和保真写回；复杂或未知 Ruby 继续局部只读。
- 读音任务返回绑定歌词 revision 的候选，必须由用户逐项或按行人工应用和确认。
- 用户词典保存明确的正文/读音映射；词典变化只影响之后生成的候选，不静默改写已确认行。
- 正文或 reading 变化使相关确认失效。reading 坐标与正文范围保持分离，为 S6 forced alignment 提供可追溯输入。

不在 S5 实现 mora/phoneme 时间、forced backend、复杂 group 或发布封装。自动候选先采用一个明确配置的日语读音后端；不可用时通过能力与界面说明，不伪造结果。

## 界面要求

延续 AMLL TTML Tool 的紧凑侧栏、浅灰分区、蓝色选中反馈与就地编辑方式。Ruby 编辑放在所选行的独立面板：正文保持主视觉，范围以可读的 base 片段呈现，reading 使用紧凑输入框；候选、已确认、需复核要有文字状态，不能只靠颜色。整体词级范围是主要操作，不制作逐字符 Ruby 输入格。

桌面工作台保持三栏结构；窄屏将 Ruby 作为单独面板切换。自动建议与词典命中说明来源，应用和确认是不同动作，保存状态沿用现有统一入口。

## 验收重点

1. `今日→きょう`、`宇宙→そら` 和含非 BMP 字符的正文使用 code-point 范围正确往返。
2. 新增、修改、删除 Ruby 都是可撤销事务；正文变化不会留下看似有效的旧确认。
3. 读音候选绑定当前 revision，旧候选和 dirty 草稿不能直接应用。
4. 词典新增或修改不改写已确认 Ruby；再次生成候选时才使用新值并标明来源。
5. TTML 未编辑邻接结构、未知扩展与 agent 继续保真；复杂 Ruby 保持只读并说明原因。
6. 只保留领域/codec、服务契约和关键浏览器闭环所需测试；类型检查、生产构建与服务测试通过。

代码继续由 gpt-5.6-luna 子代理编写，主 Agent 负责阶段拆分、架构审查、前端设计、真实交互检查和分批验收。每个可独立回退的批次通过后提交 Git。
